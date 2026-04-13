// Animated starfield
(function () {
  const canvas = document.getElementById('starfield');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');

  let w, h;
  function resize() {
    w = canvas.width = window.innerWidth;
    h = canvas.height = window.innerHeight;
  }
  window.addEventListener('resize', resize);
  resize();

  const STAR_COUNT = 180;
  const stars = [];

  const colors = [
    [255, 105, 180],  // pink
    [240, 192, 64],   // gold
    [123, 104, 238],  // purple
    [240, 232, 244],  // white
    [240, 232, 244],  // white (more common)
    [240, 232, 244],  // white
  ];

  for (let i = 0; i < STAR_COUNT; i++) {
    stars.push({
      x: Math.random() * w,
      y: Math.random() * h,
      r: Math.random() * 1.8 + 0.3,
      color: colors[Math.floor(Math.random() * colors.length)],
      twinkleSpeed: Math.random() * 0.02 + 0.005,
      twinkleOffset: Math.random() * Math.PI * 2,
      driftX: (Math.random() - 0.5) * 0.15,
      driftY: (Math.random() - 0.5) * 0.08 - 0.02, // slight upward drift
    });
  }

  let time = 0;
  function draw() {
    ctx.clearRect(0, 0, w, h);
    time += 1;

    for (const s of stars) {
      // Twinkle: oscillate opacity
      const alpha = 0.3 + 0.7 * ((Math.sin(time * s.twinkleSpeed + s.twinkleOffset) + 1) / 2);
      const [r, g, b] = s.color;

      // Glow
      ctx.beginPath();
      ctx.arc(s.x, s.y, s.r * 3, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(${r},${g},${b},${alpha * 0.08})`;
      ctx.fill();

      // Core
      ctx.beginPath();
      ctx.arc(s.x, s.y, s.r, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(${r},${g},${b},${alpha})`;
      ctx.fill();

      // Sparkle cross on bright moments
      if (alpha > 0.7) {
        const intensity = (alpha - 0.7) / 0.3; // 0 to 1
        const sparkleLen = s.r * 8 * intensity + s.r * 2;
        ctx.strokeStyle = `rgba(${r},${g},${b},${intensity * 0.9})`;
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(s.x - sparkleLen, s.y);
        ctx.lineTo(s.x + sparkleLen, s.y);
        ctx.moveTo(s.x, s.y - sparkleLen);
        ctx.lineTo(s.x, s.y + sparkleLen);
        ctx.stroke();
        // Diagonal cross for extra sparkle at peak
        if (intensity > 0.5) {
          const diagLen = sparkleLen * 0.6;
          ctx.strokeStyle = `rgba(${r},${g},${b},${(intensity - 0.5) * 1.2})`;
          ctx.beginPath();
          ctx.moveTo(s.x - diagLen, s.y - diagLen);
          ctx.lineTo(s.x + diagLen, s.y + diagLen);
          ctx.moveTo(s.x + diagLen, s.y - diagLen);
          ctx.lineTo(s.x - diagLen, s.y + diagLen);
          ctx.stroke();
        }
      }

      // Drift
      s.x += s.driftX;
      s.y += s.driftY;

      // Wrap around
      if (s.x < -5) s.x = w + 5;
      if (s.x > w + 5) s.x = -5;
      if (s.y < -5) s.y = h + 5;
      if (s.y > h + 5) s.y = -5;
    }

    requestAnimationFrame(draw);
  }
  draw();
})();

// Hamburger menu
document.addEventListener('DOMContentLoaded', () => {
  const hamburger = document.querySelector('.hamburger');
  const navLinks = document.querySelector('.nav-links');
  if (hamburger && navLinks) {
    hamburger.addEventListener('click', () => {
      navLinks.classList.toggle('open');
    });
    // Close on link click
    navLinks.querySelectorAll('a').forEach(a => {
      a.addEventListener('click', () => navLinks.classList.remove('open'));
    });
  }

  // Set active nav link
  const path = window.location.pathname;
  document.querySelectorAll('.nav-links a').forEach(a => {
    const href = a.getAttribute('href');
    if (href === path || (href === '/' && path === '/')) {
      a.classList.add('active');
    }
  });

  // Mailing list form
  const mailingForm = document.getElementById('mailingForm');
  if (mailingForm) {
    mailingForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const email = mailingForm.querySelector('input[name="email"]').value;
      try {
        const res = await fetch('/api/mailing-list', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email }),
        });
        if (res.ok) {
          mailingForm.style.display = 'none';
          document.getElementById('mailingSuccess').style.display = 'block';
        }
      } catch (err) {
        // silently fail
      }
    });
  }

  // Gallery lightbox
  const lightbox = document.getElementById('lightbox');
  if (lightbox && window.__galleryData) {
    const data = window.__galleryData;
    let current = 0;
    const img = lightbox.querySelector('img');
    const caption = lightbox.querySelector('.lightbox-caption');

    function show(index) {
      if (!data[index]) return;
      current = index;
      img.src = data[index].src;
      caption.textContent = data[index].caption;
      lightbox.classList.add('active');
      document.body.style.overflow = 'hidden';
    }

    function hide() {
      lightbox.classList.remove('active');
      document.body.style.overflow = '';
    }

    document.querySelectorAll('.gallery-item[data-index]').forEach(item => {
      item.addEventListener('click', () => {
        const idx = parseInt(item.dataset.index);
        show(idx);
      });
    });

    lightbox.querySelector('.lightbox-close').addEventListener('click', hide);
    lightbox.querySelector('.lightbox-prev').addEventListener('click', () => show(current - 1));
    lightbox.querySelector('.lightbox-next').addEventListener('click', () => show(current + 1));
    lightbox.addEventListener('click', (e) => {
      if (e.target === lightbox) hide();
    });
    document.addEventListener('keydown', (e) => {
      if (!lightbox.classList.contains('active')) return;
      if (e.key === 'Escape') hide();
      if (e.key === 'ArrowLeft') show(current - 1);
      if (e.key === 'ArrowRight') show(current + 1);
    });
  }
});
