# A.S.A.R.D – Autonomous Search and Rescue Drone System

**AI-Powered Autonomous Disaster Response and Survivor Detection Platform**

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Python](https://img.shields.io/badge/Python-3.10%2B-3776AB)](https://python.org)
[![Node.js](https://img.shields.io/badge/Node.js-18%2B-339933)](https://nodejs.org)
[![AI Model](https://img.shields.io/badge/AI-RT--DETR%20%7C%20YOLOv8-orange)](models/)
[![Hardware](https://img.shields.io/badge/Hardware-ESP32%20%7C%20MPU6050-red)](hardware/)

> **Mission Motto:** *Faster Detection | Safer Rescue | Stronger Tomorrow*

## About the Project

**A.S.A.R.D (Autonomous Search and Rescue Drone System)** is an AI-powered disaster response platform designed to assist search-and-rescue teams in locating survivors and identifying potential hazards in disaster-affected areas, including floods, earthquakes, landslides, and structural collapses.

The system combines deep-learning-based object detection using RT-DETR and YOLO models, an ESP32-based IoT sensor telemetry node, and a web-based tactical Ground Control Station. It processes camera feeds to identify potential survivors, integrates sensor telemetry for situational awareness, and presents detection results and location information through an interactive dashboard.

The platform is designed to support offline data storage and synchronization when connectivity becomes available, helping rescue teams maintain access to critical information in areas with unreliable network coverage.

## Key Features

### 1. AI-Based Survivor and Hazard Detection

- Uses RT-DETR and YOLO-based object detection for real-time human detection from camera feeds.
- Supports the identification of potential survivors in challenging disaster environments.
- Provides a framework for detecting disaster-related hazards such as landslides, falling rocks, fire, and structural damage when suitable detection models are available.
- Applies confidence thresholds and multi-frame confirmation to help reduce false-positive detections.
- Records detected targets and their associated information for rescue assessment.

### 2. Tactical Ground Control Station

- Provides an interactive 3D visualization using Three.js.
- Supports a 2D map interface using Leaflet and OpenStreetMap.
- Displays drone telemetry, detection records, GPS information, and rescue-related alerts.
- Supports waypoint planning and grid-based survey route configuration.
- Provides a centralized interface for monitoring drone status and coordinating rescue activities.

### 3. Smartphone-Based Camera Integration

- Enables a smartphone camera to act as a video source for reconnaissance and AI detection.
- Supports video streaming through WebSocket connections or compatible IP Webcam applications.
- Displays camera feeds and detection overlays through the dashboard.
- Offers a cost-effective approach to testing the computer vision pipeline before integrating a dedicated onboard camera.

### 4. IoT Sensor Telemetry

The ESP32-based sensor node collects and transmits telemetry from connected sensors.

- **MPU-6050 IMU:** Measures acceleration and angular velocity to support orientation monitoring.
- **HC-SR04 Ultrasonic Sensor:** Measures nearby object distance for basic proximity warnings.
- **NEO-6M GPS:** Provides geographic coordinates when connected and receiving a valid satellite fix.
- **MQTT Communication:** Transmits structured sensor data to the monitoring system.
- **Obstacle Alerts:** Generates proximity warnings when the measured distance falls below a configured threshold.

### 5. Offline Operation and Data Synchronization

- Supports local storage of detection records and sensor information.
- Queues data when the dashboard or communication link is temporarily unavailable.
- Synchronizes queued records when the required connection is restored.
- Supports local processing through a Python-based edge system, depending on the available hardware and installed model.
- Helps preserve important rescue information during network interruptions.

### 6. Rescue Coordination and Data Export

- Maintains a log of detected survivors and potential hazards.
- Supports rescue team assignment and status tracking through the dashboard.
- Provides CSV export for sharing recorded rescue target information.
- Presents detection confidence, available coordinates, and priority information to support human decision-making.

## System Architecture

A.S.A.R.D consists of four primary layers:

1. **Sensing Layer:** The ESP32, MPU-6050, ultrasonic sensor, GPS module, and camera provide sensor readings, positioning information, and visual data.
2. **Communication Layer:** MQTT carries sensor telemetry, while WebSocket connections support real-time video and dashboard communication.
3. **AI and Processing Layer:** The Python-based edge system processes video frames, performs object detection, combines available sensor information, and stores detection records locally.
4. **Ground Control Layer:** The Node.js web server and dashboard display telemetry, detection results, maps, alerts, and rescue coordination information.

The overall workflow is:

`Camera and Sensors → Communication → AI Detection and Sensor Processing → Local Storage → Ground Control Dashboard → Rescue Team Assessment`

## Hardware and Sensor Specifications

The sensor telemetry node is designed around an ESP32 development board.

| Component | Pin / Signal | ESP32 GPIO | Purpose |
|---|---|---|---|
| MPU-6050 | SDA | GPIO 21 | I2C data |
| MPU-6050 | SCL | GPIO 22 | I2C clock |
| MPU-6050 | VCC / GND | 3.3V / GND | Sensor power |
| HC-SR04 | TRIG | GPIO 5 | Trigger pulse |
| HC-SR04 | ECHO | GPIO 18 | Echo input |
| HC-SR04 | VCC / GND | 5V / GND | Sensor power |
| Alert LED | Anode (+) | GPIO 4 through 220 Ω resistor | Proximity warning |
| Status LED | Onboard | GPIO 2 | Status indication |
| NEO-6M GPS | RX / TX | GPIO 17 / GPIO 16 | UART communication |

**Hardware note:** The HC-SR04 ECHO signal is typically 5V. Since ESP32 GPIO pins are not 5V tolerant, use a suitable voltage divider or logic-level shifter before connecting ECHO to GPIO 18. Confirm the actual wiring and sensor compatibility before powering the circuit.

## Telemetry Data Format

The ESP32 can publish structured telemetry using JSON over the MQTT topic `rescue/drone/01/telemetry`.

Example:

```json
{
  "drone_id": "DRONE_01",
  "timestamp": 1757116800,
  "lat": 10.0234,
  "lon": 78.1234,
  "alt": 120.5,
  "speed": 12.3,
  "heading": 42,
  "battery": 82,
  "status": "IN FLIGHT",
  "obstacle_distance_m": 3.42,
  "imu": {
    "pitch": 1.2,
    "roll": -0.8,
    "yaw": 42.0
  },
  "hazard_detected": null
}
```

The values above are illustrative sample data, not live measurements. Actual fields depend on the connected sensors and telemetry implementation.

## Prerequisites and Requirements

Before running the software, ensure that the following are available:

1. **Python:** Version 3.10 or a compatible version supported by the project's dependencies.
2. **Node.js:** Version 18 or later.
3. **PyTorch:** A version compatible with the selected Python environment and CPU or CUDA-enabled GPU.
4. **Arduino IDE or Wokwi:** For ESP32 firmware development and hardware simulation.
5. **MQTT Broker:** HiveMQ or a locally configured Mosquitto broker.
6. **AI Model Weights:** The trained model files required for inference.
7. **Camera Source:** A compatible webcam, smartphone camera stream, or onboard camera.
8. **Network Connection:** Required for communication between separate devices; local processing and storage can continue offline where configured.
 
A: Manual Startup
**Step 1: Start the Ground Control Dashboard**

Open a terminal and execute:

```bash
cd "web dashboard"
npm install
npm start
```

Open the dashboard at:

`http://localhost:3000`

**Step 2: Start the Python AI System**

Open a second terminal and execute:

```bash
cd rescue_drone
pip install -r requirements.txt
python main.py
```

The Python system loads the configured AI model, processes incoming video frames, receives available telemetry, and manages detection records according to the implemented pipeline.

**Step 3: Access the Applications**

- **Ground Control Dashboard:** `http://localhost:3000`
- **Mobile Camera Portal:** `https://localhost:3443/mobile`
- **Edge API Health Check:** `http://localhost:8000/health` when the FastAPI service is running.

The actual availability of each endpoint depends on the services enabled in the project configuration.

## Smartphone Drone Camera Mode

A.S.A.R.D supports smartphone-based camera streaming for testing and reconnaissance.

1. Connect the smartphone and computer to the same Wi-Fi network or mobile hotspot.
2. Start the Ground Control Dashboard.
3. Open the mobile camera portal using the computer's local network IP address and configured HTTPS port.
4. Grant camera permissions and start the video stream.
5. Connect the stream to the configured AI inference pipeline.
6. Monitor the camera feed and available detection results through the dashboard.

An Android IP Webcam application can also be used if its stream format is supported by the application.

This mode provides a low-cost way to test the vision pipeline. Actual drone-mounted operation requires suitable mounting, power, communications, and flight-system integration.

## Edge AI and Detection Pipeline

The A.S.A.R.D detection pipeline follows these stages:

1. **Video Acquisition:** Receives frames from a smartphone, webcam, or compatible onboard camera.
2. **AI Inference:** Uses the configured RT-DETR or YOLO model to identify objects represented in its training classes.
3. **Detection Validation:** Applies confidence thresholds and, where implemented, multi-frame confirmation.
4. **Sensor Integration:** Associates detections with available GPS, orientation, altitude, and proximity data.
5. **Target Recording:** Stores detection information, timestamps, confidence scores, and available location data.
6. **Priority Assessment:** Assigns configured rescue-priority levels using the implemented scoring rules.
7. **Dashboard Synchronization:** Sends records to the Ground Control Station when communication is available.

**Important limitation:** Accurate victim GPS georeferencing requires appropriate camera calibration, camera orientation, drone position and altitude, and a suitable projection or ranging method. GPS coordinates alone do not directly convert image bounding boxes into precise ground coordinates. Likewise, hazard classification requires a model trained or configured for the relevant hazard classes.

## REST and WebSocket API Reference

The following endpoints describe the intended application interface. Confirm that each route is implemented and enabled in the current version of the server.

### Ground Control Station — Node.js

| Method | Endpoint | Purpose |
|---|---|---|
| GET | `/api/telemetry` | Retrieve current telemetry |
| POST | `/api/telemetry` | Submit telemetry data |
| GET | `/api/detections` | Retrieve recorded detections |
| POST | `/api/detections` | Submit a detection record |
| POST | `/api/detections/clear` | Clear detection history |
| POST | `/api/mission/control` | Request a mission-control action |
| POST | `/api/mission/assign` | Assign a survey route |
| GET | `/api/rescue-log` | Retrieve rescue coordination records |
| POST | `/api/rescue-log` | Create or update a rescue record |
| GET | `/api/rescue-log/csv` | Export rescue records as CSV |
| GET | `/api/network-info` | Retrieve network connection information |
| POST | `/api/ipwebcam/connect` | Configure an IP Webcam stream |

### Edge Diagnostics — FastAPI

| Method | Endpoint | Purpose |
|---|---|---|
| GET | `/health` | Check service health |
| GET | `/victims` | Retrieve locally stored victim records |
| POST | `/simulate-detection` | Submit a simulated detection |
| POST | `/simulate-hazard` | Submit a simulated hazard |

## Hardware Simulation Using Wokwi

The ESP32 telemetry node can be tested in Wokwi before physical deployment.

1. Open the [Wokwi ESP32 Project](https://wokwi.com/projects/new/esp32).
2. Add the ESP32 board and the required supported sensors.
3. Configure the wiring according to the hardware pin specification.
4. Copy the firmware into the code editor.
5. Add the required libraries and configure the simulation circuit.
6. Start the simulation and inspect the serial monitor.
7. Test ultrasonic distance readings, IMU output, status indicators, and MQTT transmission where the simulation and network configuration support them.

Wokwi testing validates the simulated firmware and sensor interactions. It does not, by itself, demonstrate autonomous flight, real-world obstacle avoidance, or full drone navigation.

## Configuration Reference

The following parameters may be used by the application, depending on the implementation in `rescue_drone/config/config.py`.

| Parameter | Example Default | Purpose |
|---|---|---|
| `DRONE_ID` | `DRONE_01` | Identifies the drone |
| `MQTT_BROKER` | `broker.hivemq.com` | MQTT broker hostname |
| `MQTT_PORT` | `1883` | MQTT connection port |
| `YOLO_CONF_THRESHOLD` | `0.28` | Minimum detection confidence |
| `YOLO_DEVICE` | `cpu` | Inference device |
| `SIMULATE_AI` | `false` | Enables or disables synthetic AI mode |
| `DASHBOARD_REST_URL` | `http://localhost:3000` | Dashboard base URL |
| `DASHBOARD_WS_URL` | `ws://localhost:3000` | Dashboard WebSocket URL |
| `SSL_PORT` | `3443` | HTTPS port for mobile camera access |

Actual defaults and variable names should be verified against the project's configuration file.

For deployments beyond local testing, configure authentication, access controls, encrypted communications, and a properly secured MQTT broker rather than relying on a public broker.

## Testing the Pipeline

Run the integration test script from the Python project directory:

```bash
cd rescue_drone
python test_pipeline.py
```

The test suite is intended to evaluate:

- AI model loading and inference performance.
- Target georeferencing calculations.
- Local database read and write operations.
- Offline queueing and synchronization logic.
- Integration between processing and communication components.

Actual test coverage and results depend on the implementation and the available hardware.

## Expected Impact

A.S.A.R.D aims to support disaster response by reducing the time required to identify potential survivors, improving situational awareness, and helping responders prioritize field assessments.

Its modular architecture combines AI-based visual detection, IoT telemetry, mapping, and offline-capable data management. The design can be extended with thermal imaging, two-way victim communication, medical-assistance requests, and additional hazard-specific detection models.

The system is intended to assist trained rescue personnel rather than replace their judgment. Detection results, location estimates, and rescue priorities should be verified before operational decisions are made.

## Future Enhancements

- Integration of RGB and thermal imaging for improved survivor detection in difficult visibility conditions.
- Two-way communication between trapped victims and rescue teams.
- Dashboard-triggered medical-assistance requests based on implemented voice or user-input detection.
- Improved GPS georeferencing and mapping using calibrated cameras and additional ranging sensors.
- Integration with a compatible flight controller for verified autonomous navigation.
- Battery-aware mission management and return-to-home functionality.
- Secure synchronization with emergency-response command systems.
- To detect the person beneath the wall we used the UWT Sensor.
