// Scan page: reads a QR code or a barcode with the phone camera, then opens that item.
(() => {
  const video = document.getElementById('scan-video');
  const status = document.getElementById('scan-status');
  const start = document.getElementById('scan-start');
  if (!video || !status || !start) return;

  let stream = null;
  let timer = null;
  let found = false;
  let decoder = null;
  const canvas = document.createElement('canvas');
  const context = canvas.getContext('2d', { willReadFrequently: true });

  const say = (text) => {
    status.textContent = text;
  };

  // The code can be our link (/i/abc123), or just the item code printed under the barcode.
  function open(text) {
    const value = String(text).trim();
    let target = null;
    try {
      const url = new URL(value, window.location.href);
      if (url.origin === window.location.origin && /^\/i\/[a-z0-9]{1,40}$/i.test(url.pathname)) target = url.pathname.toLowerCase();
    } catch {
      // Not a link. Try the plain code below.
    }
    if (!target && /^[a-z0-9]{6,40}$/i.test(value)) target = `/find?code=${encodeURIComponent(value.toLowerCase())}`;
    if (!target) {
      say('That code is not one of ours. Try another.');
      return false;
    }
    found = true;
    say('Found it. Opening...');
    stop();
    window.location.href = target;
    return true;
  }

  function stop() {
    if (timer) clearTimeout(timer);
    if (stream) stream.getTracks().forEach((track) => track.stop());
    stream = null;
  }

  async function makeDecoder() {
    // Phones with a built-in reader are fastest, and read barcodes too.
    if ('BarcodeDetector' in window) {
      try {
        const detector = new window.BarcodeDetector({ formats: ['qr_code', 'code_128'] });
        return async () => {
          const results = await detector.detect(video);
          return results[0]?.rawValue ?? null;
        };
      } catch {
        // Fall through to the QR library.
      }
    }
    // Otherwise a small QR library (it reads QR codes, not barcodes).
    await new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = '/vendor/jsQR.js';
      script.onload = resolve;
      script.onerror = reject;
      document.head.appendChild(script);
    });
    return async () => {
      const width = 480;
      const height = Math.round((video.videoHeight / video.videoWidth) * width) || 360;
      canvas.width = width;
      canvas.height = height;
      context.drawImage(video, 0, 0, width, height);
      const result = window.jsQR(context.getImageData(0, 0, width, height).data, width, height, { inversionAttempts: 'dontInvert' });
      return result ? result.data : null;
    };
  }

  async function tick() {
    if (found || !stream) return;
    try {
      if (video.readyState >= 2) {
        const text = await decoder();
        if (text) open(text);
      }
    } catch {
      // A frame that cannot be read is skipped.
    }
    if (!found) timer = setTimeout(tick, 250);
  }

  async function begin() {
    start.disabled = true;
    say('Starting the camera...');
    try {
      stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' } }, audio: false });
      video.srcObject = stream;
      await video.play();
      decoder = await makeDecoder();
      document.getElementById('scan-box').classList.add('on');
      start.hidden = true;
      say('Point the camera at the QR code on the item.');
      tick();
    } catch (error) {
      start.disabled = false;
      say(
        error && error.name === 'NotAllowedError'
          ? 'The camera is blocked. Allow it in your browser settings, or type the code below.'
          : 'The camera could not start. Type the code below instead.'
      );
    }
  }

  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    start.hidden = true;
    say('This browser cannot use the camera here. Type the code below instead.');
  } else {
    start.addEventListener('click', begin);
  }
  window.addEventListener('pagehide', stop);
})();
