'use strict';

document.addEventListener('DOMContentLoaded', () => {
  const { titulo, msg } = window.notif.getParams();

  document.getElementById('notifTitle').textContent = titulo || 'VisionFile';
  document.getElementById('notifMsg').textContent   = msg   || '';

  // Icon fallback
  document.getElementById('notifIcon').addEventListener('error', function () {
    this.style.display = 'none';
  });

  document.getElementById('btnView').addEventListener('click',  () => window.notif.view());
  document.getElementById('btnClose').addEventListener('click', () => window.notif.close());
});
