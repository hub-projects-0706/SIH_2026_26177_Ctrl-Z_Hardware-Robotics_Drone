/**
 * AEROSIGHT - Rescue Coordinates Log Module
 * Manages rescue mission dispatches, coordinates tracking, and CSV logs
 */

const RescueLogManager = (() => {
  let logEntries = [];

  async function init() {
    await fetchLog();
  }

  async function fetchLog() {
    try {
      const res = await fetch('/api/rescue-log');
      if (res.ok) {
        const json = await res.json();
        if (json.data) {
          logEntries = json.data;
          renderTable();
        }
      }
    } catch (err) {
      console.warn("Rescue log fallback", err);
    }
  }

  function renderTable() {
    const tbody = document.getElementById('rescueLogTableBody');
    if (!tbody) return;

    tbody.innerHTML = '';

    logEntries.forEach(item => {
      const tr = document.createElement('tr');

      let statusBadgeClass = 'status-badge pending';
      if (item.status === 'En Route') statusBadgeClass = 'status-badge en-route';
      if (item.status === 'Rescued') statusBadgeClass = 'status-badge rescued';

      tr.innerHTML = `
        <td style="color:var(--text-muted); font-family:var(--font-tactical);">${item.id}</td>
        <td style="font-family:var(--font-tactical); font-weight:600; color:var(--cyan-primary);">${item.coords}</td>
        <td><span class="${statusBadgeClass}">${item.status}</span></td>
        <td style="color:var(--text-primary); font-weight:500;">${item.assignedTeam}</td>
        <td style="color:var(--text-secondary); font-family:var(--font-tactical);">${item.eta}</td>
      `;

      tbody.appendChild(tr);
    });
  }

  async function addDispatch(entry) {
    try {
      const res = await fetch('/api/rescue-log', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(entry)
      });
      if (res.ok) {
        const json = await res.json();
        if (json.data) {
          logEntries.push(json.data);
          renderTable();
        }
      }
    } catch (e) {
      // Local fallback
      entry.id = logEntries.length + 1;
      entry.status = 'Pending';
      logEntries.push(entry);
      renderTable();
    }
  }

  return {
    init,
    addDispatch
  };
})();

window.RescueLogManager = RescueLogManager;
