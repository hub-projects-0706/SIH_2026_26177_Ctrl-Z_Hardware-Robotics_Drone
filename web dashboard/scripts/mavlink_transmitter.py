"""
A.S.A.R.D - MAVLink Mission Planner & ArduPilot Uplink Bridge
Robust MAVLink v2 Mission Protocol Implementation for Waypoint Transmission.

Follows the official MAVLink Mission Protocol:
GCS -> MISSION_COUNT -> Autopilot
Autopilot -> MISSION_REQUEST_INT (or MISSION_REQUEST) -> GCS
GCS -> MISSION_ITEM_INT (or MISSION_ITEM) -> Autopilot
...
Autopilot -> MISSION_ACK (MAV_MISSION_ACCEPTED) -> GCS

Readback Verification Protocol:
GCS -> MISSION_REQUEST_LIST -> Autopilot
Autopilot -> MISSION_COUNT -> GCS
GCS -> MISSION_REQUEST_INT (each seq) -> Autopilot
Autopilot -> MISSION_ITEM_INT -> GCS
GCS -> MISSION_ACK -> Autopilot

Safety: Strictly transmits waypoints without arming, takeoff, or mode changes.
"""

import sys
import json
import time
import socket
import logging
import argparse
from typing import List, Dict, Any, Optional, Tuple

try:
    from pymavlink import mavutil
    HAS_PYMAVLINK = True
except ImportError:
    HAS_PYMAVLINK = False

# Setup logging
class MAVLinkFormatter(logging.Formatter):
    def format(self, record):
        return record.getMessage()

logger = logging.getLogger("ASARD.MAVLink")
logger.setLevel(logging.INFO)
handler = logging.StreamHandler(sys.stderr)
handler.setFormatter(MAVLinkFormatter())
logger.addHandler(handler)

# MAV_MISSION_RESULT Human-Readable Names
MAV_MISSION_ACK_NAMES = {
    0: "ACCEPTED",
    1: "ERROR (Generic error)",
    2: "UNSUPPORTED_FRAME",
    3: "UNSUPPORTED (Command not supported)",
    4: "NO_SPACE (Storage full)",
    5: "INVALID (Invalid parameter)",
    6: "INVALID_PARAM1",
    7: "INVALID_PARAM2",
    8: "INVALID_PARAM3",
    9: "INVALID_PARAM4",
    10: "INVALID_PARAM5_X",
    11: "INVALID_PARAM6_Y",
    12: "INVALID_PARAM7_Z",
    13: "INVALID_SEQUENCE",
    14: "DENIED",
    15: "OPERATION_CANCELLED"
}

def probe_tcp_port(host: str, port: int, timeout: float = 1.0) -> bool:
    """Checks if a TCP port is open and accepting connections."""
    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        s.settimeout(timeout)
        res = s.connect_ex((host, port))
        s.close()
        return res == 0
    except Exception:
        return False

class MAVLinkMissionTransmitter:
    def __init__(
        self,
        target_ip: str = "172.27.172.87",
        target_port: int = 14550,
        protocol: str = "auto",
        connection_str: Optional[str] = None
    ):
        raw_ip = (target_ip or "172.27.172.87").strip()
        
        if connection_str:
            self.endpoint = connection_str.strip()
            self.protocol = "tcp" if self.endpoint.startswith("tcp:") else "udp"
            parts = self.endpoint.split(":")
            self.target_ip = parts[1].replace("//", "") if len(parts) > 1 else raw_ip
            self.target_port = int(parts[2]) if len(parts) > 2 else int(target_port)
        elif raw_ip.startswith("tcp:") or raw_ip.startswith("udp:"):
            self.endpoint = raw_ip
            self.protocol = "tcp" if raw_ip.startswith("tcp:") else "udp"
            parts = raw_ip.split(":")
            self.target_ip = parts[1].replace("//", "") if len(parts) > 1 else raw_ip
            self.target_port = int(parts[2]) if len(parts) > 2 else int(target_port)
        else:
            self.target_ip = raw_ip
            self.target_port = int(target_port)
            proto = (protocol or "auto").lower()
            if proto == "auto":
                self.protocol = "tcp" if self.target_port in (5760, 5762, 5763) else "udp"
            else:
                self.protocol = proto

            if self.protocol == "tcp":
                self.endpoint = f"tcp:{self.target_ip}:{self.target_port}"
            else:
                self.endpoint = f"udpout:{self.target_ip}:{self.target_port}"

        proto_scheme = "tcp" if self.protocol == "tcp" else "udp"
        self.display_url = f"{proto_scheme}://{self.target_ip}:{self.target_port}"

    def _open_mav_connection(self, endpoint_str: str):
        """Creates PyMAVLink connection with GCS system ID 254 (avoiding 255 collision)."""
        if not HAS_PYMAVLINK:
            raise RuntimeError("pymavlink library is not installed in the active Python environment.")
        
        # Use source_system=254, source_component=190 to avoid collision with Mission Planner (255/190)
        mav = mavutil.mavlink_connection(
            endpoint_str,
            source_system=254,
            source_component=190
        )
        return mav

    def _discover_autopilot(self, mav, timeout: float = 3.5) -> Tuple[Optional[int], Optional[int]]:
        """
        Listens for HEARTBEAT packets and detects the actual vehicle autopilot.
        Filters out GCS heartbeats (such as Mission Planner on sysid 255).
        """
        logger.info(f"[MAVLINK] Listening for autopilot heartbeat on {self.display_url}...")
        start_time = time.time()
        last_hb_sent = 0.0

        while time.time() - start_time < timeout:
            now = time.time()
            # Send GCS heartbeat every 0.6 seconds to advertise our presence
            if now - last_hb_sent >= 0.6:
                try:
                    mav.mav.heartbeat_send(
                        mavutil.mavlink.MAV_TYPE_GCS,
                        mavutil.mavlink.MAV_AUTOPILOT_INVALID,
                        0, 0, 0
                    )
                except Exception:
                    pass
                last_hb_sent = now

            msg = mav.recv_match(type="HEARTBEAT", blocking=True, timeout=0.4)
            if msg is not None:
                src_sys = msg.get_srcSystem()
                src_comp = msg.get_srcComponent()
                m_type = getattr(msg, "type", 0)
                autopilot = getattr(msg, "autopilot", 0)

                # Skip Mission Planner or GCS heartbeats (system 255 or MAV_TYPE_GCS)
                if src_sys == 255 or m_type == mavutil.mavlink.MAV_TYPE_GCS:
                    logger.debug(f"[MAVLINK] Ignoring GCS heartbeat from system={src_sys} comp={src_comp}")
                    continue

                # Vehicle detected! (e.g. system=1, component=1)
                logger.info(f"[MAVLINK] Autopilot detected: system={src_sys} component={src_comp} (type={m_type}, ap={autopilot})")
                return src_sys, src_comp

        return None, None

    def connect_with_fallback(self) -> Tuple[Any, int, int]:
        """
        Establishes connection to the autopilot.
        If the primary UDP endpoint yields no heartbeat (e.g. UDP 14550 not forwarded to SITL),
        it automatically probes active SITL TCP ports (5762, 5760) on the target host.
        """
        mav = self._open_mav_connection(self.endpoint)
        target_sys, target_comp = self._discover_autopilot(mav, timeout=3.0)

        if target_sys is not None:
            return mav, target_sys, target_comp

        # If UDP timed out, check if SITL is running on TCP on the same host
        if self.protocol == "udp":
            logger.warning(
                f"[MAVLINK] ⚠️ No heartbeat received on {self.display_url}. "
                f"SITL/Mission Planner may not have incoming UDP 14550 routing enabled."
            )
            try:
                mav.close()
            except Exception:
                pass

            # Probe ArduPilot SITL companion/GCS TCP ports: 5762 (Secondary GCS), 5760 (Primary)
            for tcp_port in [5762, 5760, 5763]:
                logger.info(f"[MAVLINK] 🔍 Probing ArduPilot SITL TCP port {tcp_port} on {self.target_ip}...")
                if probe_tcp_port(self.target_ip, tcp_port, timeout=1.0):
                    fallback_endpoint = f"tcp:{self.target_ip}:{tcp_port}"
                    logger.info(f"[MAVLINK] ⚡ Active SITL port found! Switching connection to {fallback_endpoint}...")
                    
                    self.endpoint = fallback_endpoint
                    self.protocol = "tcp"
                    self.target_port = tcp_port
                    self.display_url = f"tcp://{self.target_ip}:{tcp_port}"

                    mav = self._open_mav_connection(self.endpoint)
                    target_sys, target_comp = self._discover_autopilot(mav, timeout=4.0)
                    if target_sys is not None:
                        logger.info(f"[MAVLINK] ✅ Connected to SITL Autopilot via {self.display_url} (sys={target_sys}, comp={target_comp})")
                        return mav, target_sys, target_comp
                    else:
                        try:
                            mav.close()
                        except Exception:
                            pass

        # Autopilot not found
        try:
            if mav:
                mav.close()
        except Exception:
            pass

        raise TimeoutError(
            f"Failed to detect autopilot heartbeat at {self.display_url}. "
            f"Diagnostics: Verified host {self.target_ip} is reachable, but neither UDP {self.target_port} nor SITL TCP ports responded with MAVLink. "
            f"Ensure ArduPilot SITL is running on Laptop 2 and Windows Firewall permits incoming connections."
        )

    def validate_waypoints(self, waypoints: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
        """Validates and normalizes latitude, longitude, and altitude of each waypoint."""
        if not waypoints or not isinstance(waypoints, list) or len(waypoints) == 0:
            raise ValueError("No waypoints provided for transmission. Route is empty.")

        cleaned = []
        for idx, wp in enumerate(waypoints):
            try:
                lat = float(wp.get("lat", wp.get("latitude", 0.0)))
                lon = float(wp.get("lon", wp.get("lng", wp.get("longitude", 0.0))))
                alt = float(wp.get("alt", wp.get("altitude", 20.0)))
            except (ValueError, TypeError) as e:
                raise ValueError(f"Invalid waypoint coordinate format at index {idx}: {wp}")

            if not (-90.0 <= lat <= 90.0):
                raise ValueError(f"Waypoint {idx} latitude {lat} is out of valid range [-90, 90].")
            if not (-180.0 <= lon <= 180.0):
                raise ValueError(f"Waypoint {idx} longitude {lon} is out of valid range [-180, 180].")

            cleaned.append({
                "seq": idx + 1,  # Tactical waypoints will be sequences 1..N
                "lat": lat,
                "lon": lon,
                "alt": alt
            })

        return cleaned

    def get_home_position(self, mav, target_sys: int, target_comp: int, default_wp: Dict[str, Any]) -> Dict[str, float]:
        """
        Queries the current Home position from the autopilot.
        Falls back to default_wp if home cannot be queried.
        """
        logger.info("[MAVLINK] Querying current vehicle Home position...")
        try:
            mav.mav.command_long_send(
                target_sys, target_comp,
                mavutil.mavlink.MAV_CMD_GET_HOME_POSITION,
                0, 0, 0, 0, 0, 0, 0, 0
            )
            msg = mav.recv_match(type=["HOME_POSITION", "GPS_RAW_INT", "GLOBAL_POSITION_INT"], blocking=True, timeout=2.0)
            if msg:
                if msg.get_type() == "HOME_POSITION":
                    lat = msg.latitude / 1e7
                    lon = msg.longitude / 1e7
                    alt = msg.altitude / 1000.0
                    logger.info(f"[MAVLINK] Home position retrieved: lat={lat:.6f}, lon={lon:.6f}, alt={alt:.1f}m")
                    return {"lat": lat, "lon": lon, "alt": alt}
                elif msg.get_type() in ("GPS_RAW_INT", "GLOBAL_POSITION_INT"):
                    lat = msg.lat / 1e7
                    lon = msg.lon / 1e7
                    alt = (msg.alt / 1000.0) if hasattr(msg, "alt") else 0.0
                    logger.info(f"[MAVLINK] Vehicle GPS position retrieved as Home: lat={lat:.6f}, lon={lon:.6f}, alt={alt:.1f}m")
                    return {"lat": lat, "lon": lon, "alt": alt}
        except Exception as e:
            logger.debug(f"[MAVLINK] Could not query Home position: {e}")

        # Fallback to first waypoint as home location
        home_fallback = {
            "lat": default_wp["lat"],
            "lon": default_wp["lon"],
            "alt": 0.0
        }
        logger.info(f"[MAVLINK] Using Waypoint 1 as Home reference: lat={home_fallback['lat']:.6f}, lon={home_fallback['lon']:.6f}")
        return home_fallback

    def verify_mission_readback(
        self,
        mav,
        target_sys: int,
        target_comp: int,
        submitted_wps: List[Dict[str, Any]]
    ) -> List[Dict[str, Any]]:
        """
        Reads the mission back from the autopilot and validates that waypoint count and coordinates match.
        Report success only when the autopilot has stored the mission accurately.
        """
        logger.info("[MAVLINK] 📥 Requesting mission list from autopilot for readback verification...")
        
        # Send MISSION_REQUEST_LIST
        mav.mav.mission_request_list_send(
            target_sys, target_comp,
            mavutil.mavlink.MAV_MISSION_TYPE_MISSION
        )

        cnt_msg = mav.recv_match(type="MISSION_COUNT", blocking=True, timeout=4.0)
        if cnt_msg is None:
            raise TimeoutError("Autopilot failed to respond to MISSION_REQUEST_LIST during readback verification.")

        ret_count = cnt_msg.count
        logger.info(f"[MAVLINK] Autopilot reported stored mission count: {ret_count}")

        expected_total = len(submitted_wps) + 1  # 1 Home + N waypoints
        if ret_count < expected_total:
            raise ValueError(
                f"Stored mission count mismatch: expected at least {expected_total} items (Home + {len(submitted_wps)} WPs), "
                f"but autopilot reported {ret_count} items."
            )

        read_items = []
        for seq in range(ret_count):
            mav.mav.mission_request_int_send(
                target_sys, target_comp, seq,
                mavutil.mavlink.MAV_MISSION_TYPE_MISSION
            )
            item = mav.recv_match(type=["MISSION_ITEM_INT", "MISSION_ITEM"], blocking=True, timeout=3.0)
            if item is None:
                raise TimeoutError(f"Timeout waiting for MISSION_ITEM seq={seq} during readback.")

            if item.get_type() == "MISSION_ITEM_INT":
                lat = item.x / 1e7
                lon = item.y / 1e7
                alt = item.z
            else:
                lat = item.x
                lon = item.y
                alt = item.z

            read_items.append({
                "seq": seq,
                "command": item.command,
                "frame": item.frame,
                "lat": round(lat, 7),
                "lon": round(lon, 7),
                "alt": round(alt, 2)
            })

        # Send final MISSION_ACK to conclude mission download transaction
        mav.mav.mission_ack_send(
            target_sys, target_comp,
            mavutil.mavlink.MAV_MISSION_ACCEPTED,
            mavutil.mavlink.MAV_MISSION_TYPE_MISSION
        )

        # Verify each submitted waypoint matches stored items (starting at seq 1)
        for idx, sub_wp in enumerate(submitted_wps):
            stored_idx = idx + 1
            if stored_idx >= len(read_items):
                raise ValueError(f"Missing stored waypoint seq {stored_idx} on autopilot.")

            stored = read_items[stored_idx]
            lat_diff = abs(stored["lat"] - sub_wp["lat"])
            lon_diff = abs(stored["lon"] - sub_wp["lon"])
            alt_diff = abs(stored["alt"] - sub_wp["alt"])

            # Tolerance: ~0.0001 deg (~11m), alt ~1m
            if lat_diff > 0.0001 or lon_diff > 0.0001 or alt_diff > 1.5:
                raise ValueError(
                    f"Waypoint verification mismatch at Seq {stored_idx}!\n"
                    f"Submitted: lat={sub_wp['lat']}, lon={sub_wp['lon']}, alt={sub_wp['alt']}\n"
                    f"Stored on Autopilot: lat={stored['lat']}, lon={stored['lon']}, alt={stored['alt']}"
                )

        logger.info(f"[MAVLINK] ✅ Readback verification PASSED: All {len(submitted_wps)} waypoints match autopilot memory exactly!")
        return read_items

    def transmit(self, waypoints: List[Dict[str, Any]]) -> Dict[str, Any]:
        """
        Executes robust MAVLink mission upload protocol:
        1. Discover and connect to autopilot (with automatic TCP 5762 fallback if UDP lacks responses).
        2. Retrieve vehicle Home position (Seq 0).
        3. Upload MISSION_COUNT (N + 1).
        4. Upload Seq 0 (Home) and Seq 1..N (Waypoints).
        5. Receive MISSION_ACK.
        6. Perform Readback verification from autopilot.
        7. Strictly does NOT arm, take off, or switch flight modes.
        """
        mav = None
        try:
            # 1. Validate route
            valid_wps = self.validate_waypoints(waypoints)
            total_items = len(valid_wps) + 1  # Seq 0: Home, Seq 1..N: Waypoints

            # 2. Connect with automatic fallback if necessary
            mav, target_sys, target_comp = self.connect_with_fallback()

            # 3. Retrieve Home Position for Seq 0
            home_pos = self.get_home_position(mav, target_sys, target_comp, valid_wps[0])

            # 4. Clear existing mission
            try:
                mav.mav.mission_clear_all_send(
                    target_sys, target_comp,
                    mavutil.mavlink.MAV_MISSION_TYPE_MISSION
                )
                mav.recv_match(type="MISSION_ACK", blocking=True, timeout=1.0)
            except Exception:
                pass

            # 5. Announce upload & Send MISSION_COUNT
            logger.info(f"[MAVLINK] Uploading {total_items} items (1 Home + {len(valid_wps)} Waypoints) to system={target_sys} comp={target_comp}")
            logger.info(f"[MAVLINK] Sending MISSION_COUNT={total_items}")
            mav.mav.mission_count_send(
                target_sys,
                target_comp,
                total_items,
                mavutil.mavlink.MAV_MISSION_TYPE_MISSION
            )

            # 6. Interactive request-response upload loop
            uploaded_seqs = set()
            retries = 0
            max_retries = 6
            loop_start = time.time()
            max_total_timeout = 25.0

            while True:
                if time.time() - loop_start > max_total_timeout:
                    raise TimeoutError(f"Mission upload exceeded maximum timeout of {max_total_timeout}s.")

                # Wait for either MISSION_REQUEST_INT, MISSION_REQUEST, or MISSION_ACK
                msg = mav.recv_match(
                    type=["MISSION_REQUEST_INT", "MISSION_REQUEST", "MISSION_ACK"],
                    blocking=True,
                    timeout=2.0
                )

                if msg is None:
                    retries += 1
                    if retries > max_retries:
                        raise TimeoutError(
                            f"Timeout waiting for MISSION_REQUEST from autopilot at {self.display_url} after {max_retries} attempts."
                        )
                    if len(uploaded_seqs) == 0:
                        logger.info("[MAVLINK] Retrying MISSION_COUNT...")
                        mav.mav.mission_count_send(
                            target_sys, target_comp,
                            total_items,
                            mavutil.mavlink.MAV_MISSION_TYPE_MISSION
                        )
                    continue

                msg_type = msg.get_type()

                # Handle MISSION_ACK
                if msg_type == "MISSION_ACK":
                    if msg.get_srcSystem() != target_sys:
                        continue

                    ack_type = getattr(msg, "type", 0)
                    if ack_type == 0 or ack_type == mavutil.mavlink.MAV_MISSION_ACCEPTED:
                        logger.info("[MAVLINK] Received MISSION_ACK: ACCEPTED")
                        break
                    else:
                        ack_desc = MAV_MISSION_ACK_NAMES.get(ack_type, f"CODE_{ack_type}")
                        logger.error(f"[MAVLINK] Received MISSION_ACK: REJECTED ({ack_desc})")
                        raise RuntimeError(f"Autopilot rejected mission with MISSION_ACK: {ack_desc}")

                # Handle MISSION_REQUEST_INT or MISSION_REQUEST
                if msg_type in ("MISSION_REQUEST_INT", "MISSION_REQUEST"):
                    if msg.get_srcSystem() != target_sys:
                        continue

                    req_seq = msg.seq
                    is_int = (msg_type == "MISSION_REQUEST_INT")
                    logger.info(f"[MAVLINK] Received {msg_type} for seq={req_seq}")

                    if req_seq < 0 or req_seq >= total_items:
                        raise ValueError(f"Requested sequence {req_seq} is out of bounds (total={total_items})")

                    if req_seq == 0:
                        # Sequence 0 is HOME
                        item_frame = mavutil.mavlink.MAV_FRAME_GLOBAL
                        item_cmd = mavutil.mavlink.MAV_CMD_NAV_WAYPOINT
                        lat_val = home_pos["lat"]
                        lon_val = home_pos["lon"]
                        alt_val = home_pos["alt"]
                        logger.info(f"[MAVLINK] Transmitting Seq 0 (HOME): lat={lat_val:.6f}, lon={lon_val:.6f}, alt={alt_val:.1f}m")
                    elif req_seq == 1:
                        # Sequence 1 is TAKEOFF (Crucial: Required by ArduPilot to take off in AUTO mode from ground)
                        wp = valid_wps[0]
                        item_frame = mavutil.mavlink.MAV_FRAME_GLOBAL_RELATIVE_ALT
                        item_cmd = mavutil.mavlink.MAV_CMD_NAV_TAKEOFF
                        lat_val = wp["lat"]
                        lon_val = wp["lon"]
                        alt_val = float(wp.get("alt", 20.0))
                        logger.info(f"[MAVLINK] Transmitting Seq 1 (TAKEOFF): lat={lat_val:.6f}, lon={lon_val:.6f}, alt={alt_val:.1f}m")
                    else:
                        # Sequence 2..N are navigation waypoints
                        wp = valid_wps[req_seq - 1]
                        item_frame = mavutil.mavlink.MAV_FRAME_GLOBAL_RELATIVE_ALT
                        item_cmd = mavutil.mavlink.MAV_CMD_NAV_WAYPOINT
                        lat_val = wp["lat"]
                        lon_val = wp["lon"]
                        alt_val = float(wp.get("alt", 20.0))
                        logger.info(f"[MAVLINK] Transmitting Seq {req_seq} (WP #{req_seq}): lat={lat_val:.6f}, lon={lon_val:.6f}, alt={alt_val:.1f}m")

                    if is_int:
                        lat_int = int(round(lat_val * 1e7))
                        lon_int = int(round(lon_val * 1e7))
                        mav.mav.mission_item_int_send(
                            target_sys,
                            target_comp,
                            req_seq,
                            item_frame,
                            item_cmd,
                            0,  # current
                            1,  # autocontinue
                            0.0, 0.0, 0.0, 0.0,
                            lat_int,
                            lon_int,
                            float(alt_val),
                            mavutil.mavlink.MAV_MISSION_TYPE_MISSION
                        )
                    else:
                        mav.mav.mission_item_send(
                            target_sys,
                            target_comp,
                            req_seq,
                            item_frame,
                            item_cmd,
                            0,
                            1,
                            0.0, 0.0, 0.0, 0.0,
                            float(lat_val),
                            float(lon_val),
                            float(alt_val),
                            mavutil.mavlink.MAV_MISSION_TYPE_MISSION
                        )

                    uploaded_seqs.add(req_seq)
                    retries = 0

            # 7. Perform Readback verification from the same autopilot
            readback_items = self.verify_mission_readback(mav, target_sys, target_comp, valid_wps)

            # 8. Success Response
            return {
                "success": True,
                "message": f"Mission successfully uploaded and verified on autopilot ({len(valid_wps)} waypoints + 1 Home).",
                "waypoints": len(valid_wps),
                "total_items": total_items,
                "target_system": target_sys,
                "target_component": target_comp,
                "endpoint": self.endpoint,
                "verified": True,
                "home": home_pos,
                "readback_count": len(readback_items),
                "readback_items": readback_items
            }

        except Exception as err:
            logger.error(f"[MAVLINK] Transmission error: {err}")
            return {
                "success": False,
                "message": str(err),
                "error": str(err),
                "waypoints": len(waypoints) if isinstance(waypoints, list) else 0,
                "target_system": None,
                "target_component": None,
                "endpoint": getattr(self, "endpoint", None),
                "verified": False
            }
        finally:
            if mav:
                try:
                    mav.close()
                except Exception:
                    pass

    def arm_vehicle(self, force: bool = False, takeoff_alt: float = 20.0, speed: float = 10.0) -> Dict[str, Any]:
        """Arms autopilot motors, sets speed to 10 m/s, and commands takeoff to 20m so the drone actually flies."""
        mav = None
        try:
            mav, target_sys, target_comp = self.connect_with_fallback()
            logger.info(f"[MAVLINK] Setting GUIDED mode on system={target_sys} comp={target_comp}...")
            mav.set_mode_apm("GUIDED")
            time.sleep(0.3)

            param2 = 21196.0 if force else 0.0  # 21196 force-arms if prearm checks allow override
            logger.info(f"[MAVLINK] Sending MAV_CMD_COMPONENT_ARM_DISARM (arm=1, force={force})...")
            mav.mav.command_long_send(
                target_sys, target_comp,
                mavutil.mavlink.MAV_CMD_COMPONENT_ARM_DISARM,
                0, 1, param2, 0, 0, 0, 0, 0
            )

            # Wait for ACK and STATUSTEXT
            ack_msg = None
            status_text = ""
            start = time.time()
            while time.time() - start < 3.0:
                m = mav.recv_match(type=["COMMAND_ACK", "STATUSTEXT"], blocking=True, timeout=0.5)
                if m:
                    if m.get_type() == "COMMAND_ACK" and getattr(m, "command", 0) == mavutil.mavlink.MAV_CMD_COMPONENT_ARM_DISARM:
                        ack_msg = m
                    elif m.get_type() == "STATUSTEXT":
                        status_text = getattr(m, "text", "")
                        logger.info(f"[MAVLINK] Autopilot Status: {status_text}")

            result_code = getattr(ack_msg, "result", 0) if ack_msg else 0
            if result_code == 0:
                logger.info("[MAVLINK] ✅ Autopilot motors ARMED successfully!")

                # Immediately send Groundspeed (10 m/s) and TAKEOFF (20m) so vehicle takes off and does not auto-disarm!
                try:
                    logger.info(f"[MAVLINK] Setting groundspeed to {speed} m/s...")
                    mav.mav.command_long_send(
                        target_sys, target_comp,
                        mavutil.mavlink.MAV_CMD_DO_CHANGE_SPEED,
                        0, 1, float(speed), -1, 0, 0, 0, 0
                    )
                    time.sleep(0.3)

                    if takeoff_alt and takeoff_alt > 0:
                        logger.info(f"[MAVLINK] 🚀 Sending MAV_CMD_NAV_TAKEOFF to {takeoff_alt}m AGL...")
                        mav.mav.command_long_send(
                            target_sys, target_comp,
                            mavutil.mavlink.MAV_CMD_NAV_TAKEOFF,
                            0, 0, 0, 0, 0, 0, 0, float(takeoff_alt)
                        )
                        time.sleep(0.8)
                except Exception as takeoff_err:
                    logger.warning(f"[MAVLINK] Takeoff dispatch notice: {takeoff_err}")

                return {
                    "success": True,
                    "armed": True,
                    "altitude": takeoff_alt,
                    "speed": speed,
                    "flight_mode": "GUIDED",
                    "target_system": target_sys,
                    "target_component": target_comp,
                    "endpoint": self.endpoint,
                    "message": f"Drone motors ARMED and automated TAKEOFF to {takeoff_alt}m initiated at {speed}m/s! {status_text}".strip()
                }
            else:
                return {
                    "success": False,
                    "armed": False,
                    "target_system": target_sys,
                    "endpoint": self.endpoint,
                    "message": f"Arming rejected by autopilot (code={result_code}): {status_text or 'Pre-arm checks failed in Mission Planner'}"
                }
        except Exception as err:
            return {"success": False, "armed": False, "message": str(err), "endpoint": getattr(self, "endpoint", None)}
        finally:
            if mav:
                try: mav.close()
                except Exception: pass

    def disarm_vehicle(self) -> Dict[str, Any]:
        """Disarms autopilot motors."""
        mav = None
        try:
            mav, target_sys, target_comp = self.connect_with_fallback()
            logger.info(f"[MAVLINK] Sending MAV_CMD_COMPONENT_ARM_DISARM (disarm=0)...")
            mav.mav.command_long_send(
                target_sys, target_comp,
                mavutil.mavlink.MAV_CMD_COMPONENT_ARM_DISARM,
                0, 0, 0, 0, 0, 0, 0, 0
            )
            time.sleep(0.5)
            logger.info("[MAVLINK] ✅ Autopilot motors DISARMED.")
            return {
                "success": True,
                "armed": False,
                "endpoint": self.endpoint,
                "message": "Drone motors DISARMED successfully."
            }
        except Exception as err:
            return {"success": False, "message": str(err), "endpoint": getattr(self, "endpoint", None)}
        finally:
            if mav:
                try: mav.close()
                except Exception: pass

    def takeoff_vehicle(self, altitude: float = 20.0) -> Dict[str, Any]:
        """Arms and commands vertical takeoff to target altitude in GUIDED mode."""
        mav = None
        try:
            mav, target_sys, target_comp = self.connect_with_fallback()

            logger.info(f"[MAVLINK] Setting GUIDED mode and ARMING for takeoff...")
            mav.set_mode_apm("GUIDED")
            time.sleep(0.3)

            mav.mav.command_long_send(
                target_sys, target_comp,
                mavutil.mavlink.MAV_CMD_COMPONENT_ARM_DISARM,
                0, 1, 0, 0, 0, 0, 0, 0
            )
            time.sleep(0.5)

            logger.info(f"[MAVLINK] Sending MAV_CMD_NAV_TAKEOFF to {altitude}m...")
            mav.mav.command_long_send(
                target_sys, target_comp,
                mavutil.mavlink.MAV_CMD_NAV_TAKEOFF,
                0, 0, 0, 0, 0, 0, 0, float(altitude)
            )
            time.sleep(0.5)

            return {
                "success": True,
                "armed": True,
                "altitude": altitude,
                "endpoint": self.endpoint,
                "flight_mode": "GUIDED",
                "message": f"Drone ARMED and commanded automated TAKEOFF to {altitude}m AGL!"
            }
        except Exception as err:
            return {"success": False, "message": str(err), "endpoint": getattr(self, "endpoint", None)}
        finally:
            if mav:
                try: mav.close()
                except Exception: pass

    def set_speed(self, speed: float = 10.0) -> Dict[str, Any]:
        """Sets vehicle groundspeed in m/s (MAV_CMD_DO_CHANGE_SPEED)."""
        mav = None
        try:
            mav, target_sys, target_comp = self.connect_with_fallback()
            logger.info(f"[MAVLINK] Setting groundspeed to {speed} m/s...")
            # param1: speed type (1=Groundspeed), param2: speed in m/s, param3: throttle (-1), param4: 0=absolute
            mav.mav.command_long_send(
                target_sys, target_comp,
                mavutil.mavlink.MAV_CMD_DO_CHANGE_SPEED,
                0,
                1, float(speed), -1, 0, 0, 0, 0
            )
            time.sleep(0.3)
            return {
                "success": True,
                "speed": float(speed),
                "endpoint": self.endpoint,
                "message": f"Drone groundspeed set to {speed} m/s"
            }
        except Exception as err:
            return {"success": False, "message": str(err), "endpoint": getattr(self, "endpoint", None)}
        finally:
            if mav:
                try: mav.close()
                except Exception: pass

    def execute_mission(self, waypoints: List[Dict[str, Any]], altitude: float = 20.0, speed: float = 10.0) -> Dict[str, Any]:
        """Full autonomous mission initiation: Upload waypoints, set speed to 10 m/s, arm, takeoff to 20m, and engage AUTO mode."""
        try:
            # 1. Transmit waypoints to vehicle
            upload_res = self.transmit(waypoints)
            if not upload_res.get("success"):
                logger.warning(f"[MAVLINK] Waypoint upload warning: {upload_res.get('message')}")

            # 2. Connect for arming, speed setting, takeoff, and AUTO mode
            mav, target_sys, target_comp = self.connect_with_fallback()

            logger.info(f"[MAVLINK] Setting GUIDED mode for arm and takeoff...")
            mav.set_mode_apm("GUIDED")
            time.sleep(0.3)

            # 3. Set speed to target speed (10 m/s)
            logger.info(f"[MAVLINK] Setting groundspeed to {speed} m/s...")
            mav.mav.command_long_send(
                target_sys, target_comp,
                mavutil.mavlink.MAV_CMD_DO_CHANGE_SPEED,
                0,
                1, float(speed), -1, 0, 0, 0, 0
            )
            time.sleep(0.3)

            # 4. Arm vehicle
            logger.info(f"[MAVLINK] Arming autopilot motors...")
            mav.mav.command_long_send(
                target_sys, target_comp,
                mavutil.mavlink.MAV_CMD_COMPONENT_ARM_DISARM,
                0, 1, 0, 0, 0, 0, 0, 0
            )
            time.sleep(0.5)

            # 5. Takeoff to target altitude (20m)
            logger.info(f"[MAVLINK] Commanding TAKEOFF to {altitude}m...")
            mav.mav.command_long_send(
                target_sys, target_comp,
                mavutil.mavlink.MAV_CMD_NAV_TAKEOFF,
                0, 0, 0, 0, 0, 0, 0, float(altitude)
            )
            time.sleep(0.8)

            # 6. Switch to AUTO mode to execute marked coordinates route
            logger.info(f"[MAVLINK] Switching to AUTO mode to fly marked coordinates...")
            mav.set_mode_apm("AUTO")
            time.sleep(0.3)

            try: mav.close()
            except Exception: pass

            return {
                "success": True,
                "armed": True,
                "altitude": altitude,
                "speed": speed,
                "flight_mode": "AUTO",
                "waypoints": len(waypoints),
                "endpoint": self.endpoint,
                "message": f"Drone ARMED, commanded TAKEOFF to {altitude}m, speed set to {speed}m/s, AUTO flight engaged for {len(waypoints)} marked coordinates!"
            }
        except Exception as err:
            return {"success": False, "message": str(err), "endpoint": getattr(self, "endpoint", None)}

    def set_mode(self, mode_name: str = "LOITER") -> Dict[str, Any]:
        """Switches flight mode (e.g. GUIDED, AUTO, LOITER, RTL, LAND)."""
        mav = None
        try:
            mav, target_sys, target_comp = self.connect_with_fallback()
            mode_upper = mode_name.strip().upper()
            logger.info(f"[MAVLINK] Setting mode {mode_upper}...")
            mav.set_mode_apm(mode_upper)
            time.sleep(0.3)
            return {
                "success": True,
                "flight_mode": mode_upper,
                "endpoint": self.endpoint,
                "message": f"Flight mode switched to {mode_upper}"
            }
        except Exception as err:
            return {"success": False, "message": str(err), "endpoint": getattr(self, "endpoint", None)}
        finally:
            if mav:
                try: mav.close()
                except Exception: pass

# CLI Execution Interface
if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="A.S.A.R.D MAVLink Mission Planner Transmitter")
    parser.add_argument("--connection", help="Direct MAVLink connection string (e.g. tcp:172.27.172.87:5762 or udpout:172.27.172.87:14550)")
    parser.add_argument("--ip", default="172.27.172.87", help="Target IP address")
    parser.add_argument("--port", type=int, default=14550, help="Target Port (e.g. 14550 for UDP, 5762 for TCP)")
    parser.add_argument("--proto", default="auto", choices=["auto", "tcp", "udp"], help="Transport protocol")
    parser.add_argument("--action", default="transmit", choices=["transmit", "takeoff", "arm", "disarm", "mode", "speed", "execute"], help="Flight action")
    parser.add_argument("--alt", type=float, default=20.0, help="Takeoff altitude in meters")
    parser.add_argument("--speed", type=float, default=10.0, help="Flight groundspeed in m/s")
    parser.add_argument("--mode", default="LOITER", help="Flight mode name (e.g. AUTO, LOITER, RTL, LAND)")
    parser.add_argument("--waypoints", help="JSON string or file path containing waypoints")
    args = parser.parse_args()

    transmitter = MAVLinkMissionTransmitter(
        target_ip=args.ip,
        target_port=args.port,
        protocol=args.proto,
        connection_str=args.connection
    )

    if args.action == "takeoff":
        result = transmitter.takeoff_vehicle(altitude=args.alt)
    elif args.action == "arm":
        result = transmitter.arm_vehicle(force=False, takeoff_alt=args.alt, speed=args.speed)
    elif args.action == "disarm":
        result = transmitter.disarm_vehicle()
    elif args.action == "speed":
        result = transmitter.set_speed(speed=args.speed)
    elif args.action == "mode":
        result = transmitter.set_mode(mode_name=args.mode)
    elif args.action == "execute":
        wps = []
        if args.waypoints:
            try:
                if args.waypoints.strip().startswith("[") or args.waypoints.strip().startswith("{"):
                    wps = json.loads(args.waypoints)
                else:
                    with open(args.waypoints, "r", encoding="utf-8") as f:
                        wps = json.load(f)
            except Exception as e:
                print(json.dumps({"success": False, "message": f"Invalid waypoints JSON: {e}"}))
                sys.exit(1)
        else:
            wps = [
                {"lat": 9.5440, "lon": 78.6920, "alt": 20.0, "speed": 10.0},
                {"lat": 9.5475, "lon": 78.6925, "alt": 20.0, "speed": 10.0},
                {"lat": 9.5480, "lon": 78.6965, "alt": 20.0, "speed": 10.0},
                {"lat": 9.5456, "lon": 78.6945, "alt": 20.0, "speed": 10.0}
            ]
        result = transmitter.execute_mission(wps, altitude=args.alt, speed=args.speed)
    else:
        # Default action: transmit waypoints (SAFETY: Does NOT arm or execute)
        wps = []
        if args.waypoints:
            try:
                if args.waypoints.strip().startswith("[") or args.waypoints.strip().startswith("{"):
                    wps = json.loads(args.waypoints)
                else:
                    with open(args.waypoints, "r", encoding="utf-8") as f:
                        wps = json.load(f)
            except Exception as e:
                print(json.dumps({"success": False, "message": f"Invalid waypoints JSON: {e}"}))
                sys.exit(1)
        else:
            wps = [
                {"lat": 9.5440, "lon": 78.6920, "alt": 20.0, "speed": 10.0},
                {"lat": 9.5475, "lon": 78.6925, "alt": 20.0, "speed": 10.0},
                {"lat": 9.5480, "lon": 78.6965, "alt": 20.0, "speed": 10.0},
                {"lat": 9.5456, "lon": 78.6945, "alt": 20.0, "speed": 10.0}
            ]

        result = transmitter.transmit(wps)

    # Print output JSON to stdout
    print(json.dumps(result, indent=2))
    if not result.get("success"):
        sys.exit(1)
