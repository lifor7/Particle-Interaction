const canvas = document.getElementById('canvas');
const ctx = canvas.getContext('2d');

let width = 0;
let height = 0;
let dpr = 1;
let particles = [];
let mouseX = -1000;
let mouseY = -1000;
let isAttract = true;
let animating = true;
let animationId = null;

const CONFIG = {
  influenceRadius: 160,
  attractStrength: 0.6,
  repelStrength: 0.8,
  maxSpeed: 6,
  friction: 0.98,
  connectionDistance: 120,
  particleAreaDivisor: 8000,
};

class Particle {
  constructor(x, y) {
    this.x = x;
    this.y = y;
    this.vx = (Math.random() - 0.5) * 2;
    this.vy = (Math.random() - 0.5) * 2;
    this.radius = Math.random() * 2 + 1.5;
    this.baseHue = Math.random() * 60 + 180;
  }

  applyMouseForce(mx, my) {
    const dx = mx - this.x;
    const dy = my - this.y;
    const dist = Math.hypot(dx, dy);

    if (dist < CONFIG.influenceRadius && dist > 0) {
      const force = (CONFIG.influenceRadius - dist) / CONFIG.influenceRadius;
      const angle = Math.atan2(dy, dx);
      const strength = isAttract ? CONFIG.attractStrength : -CONFIG.repelStrength;

      this.vx += Math.cos(angle) * force * strength;
      this.vy += Math.sin(angle) * force * strength;
    }
  }

  update() {
    this.vx *= CONFIG.friction;
    this.vy *= CONFIG.friction;

    const speed = Math.hypot(this.vx, this.vy);
    if (speed > CONFIG.maxSpeed) {
      this.vx = (this.vx / speed) * CONFIG.maxSpeed;
      this.vy = (this.vy / speed) * CONFIG.maxSpeed;
    }

    this.x += this.vx;
    this.y += this.vy;
    this.wrap();
  }

  wrap() {
    if (this.x < 0) this.x = width;
    if (this.x > width) this.x = 0;
    if (this.y < 0) this.y = height;
    if (this.y > height) this.y = 0;
  }

  getColor(mx, my) {
    const dist = Math.hypot(mx - this.x, my - this.y);
    const proximity = dist < CONFIG.influenceRadius
      ? 1 - dist / CONFIG.influenceRadius
      : 0;
    const speed = Math.hypot(this.vx, this.vy);
    const hue = this.baseHue + proximity * 40 + speed * 5;
    const lightness = 55 + proximity * 20;
    return `hsla(${hue}, 80%, ${lightness}%, ${0.6 + proximity * 0.4})`;
  }

  draw() {
    ctx.beginPath();
    ctx.arc(this.x, this.y, this.radius, 0, Math.PI * 2);
    ctx.fillStyle = this.getColor(mouseX, mouseY);
    ctx.fill();
  }
}

function resize() {
  dpr = window.devicePixelRatio || 1;
  width = window.innerWidth;
  height = window.innerHeight;

  canvas.width = width * dpr;
  canvas.height = height * dpr;
  canvas.style.width = `${width}px`;
  canvas.style.height = `${height}px`;

  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  initParticles();
}

function initParticles() {
  const count = Math.floor((width * height) / CONFIG.particleAreaDivisor);
  particles = Array.from({ length: count }, () =>
    new Particle(Math.random() * width, Math.random() * height)
  );
}

function drawConnections() {
  for (let i = 0; i < particles.length; i++) {
    for (let j = i + 1; j < particles.length; j++) {
      const dx = particles[i].x - particles[j].x;
      const dy = particles[i].y - particles[j].y;
      const dist = Math.hypot(dx, dy);

      if (dist < CONFIG.connectionDistance) {
        const alpha = (1 - dist / CONFIG.connectionDistance) * 0.35;
        ctx.beginPath();
        ctx.moveTo(particles[i].x, particles[i].y);
        ctx.lineTo(particles[j].x, particles[j].y);
        ctx.strokeStyle = `rgba(100, 180, 255, ${alpha})`;
        ctx.lineWidth = 0.8;
        ctx.stroke();
      }
    }
  }
}

function drawMouseGlow() {
  if (mouseX < 0 || mouseY < 0) return;

  const gradient = ctx.createRadialGradient(
    mouseX, mouseY, 0,
    mouseX, mouseY, CONFIG.influenceRadius
  );
  const color = isAttract ? '100, 180, 255' : '255, 100, 120';
  gradient.addColorStop(0, `rgba(${color}, 0.08)`);
  gradient.addColorStop(1, `rgba(${color}, 0)`);

  ctx.beginPath();
  ctx.arc(mouseX, mouseY, CONFIG.influenceRadius, 0, Math.PI * 2);
  ctx.fillStyle = gradient;
  ctx.fill();
}

function animate() {
  if (!animating) return;

  ctx.fillStyle = 'rgba(10, 10, 18, 0.15)';
  ctx.fillRect(0, 0, width, height);

  drawMouseGlow();
  drawConnections();

  for (const particle of particles) {
    particle.applyMouseForce(mouseX, mouseY);
    particle.update();
    particle.draw();
  }

  animationId = requestAnimationFrame(animate);
}

function setPointer(x, y) {
  mouseX = x;
  mouseY = y;
}

canvas.addEventListener('mousemove', (e) => {
  setPointer(e.clientX, e.clientY);
});

canvas.addEventListener('mouseleave', () => {
  mouseX = -1000;
  mouseY = -1000;
});

canvas.addEventListener('touchmove', (e) => {
  e.preventDefault();
  const touch = e.touches[0];
  setPointer(touch.clientX, touch.clientY);
}, { passive: false });

canvas.addEventListener('touchend', () => {
  mouseX = -1000;
  mouseY = -1000;
});

window.addEventListener('keydown', (e) => {
  if (e.code === 'Space' || e.code === 'KeyR') {
    isAttract = !isAttract;
  }
});

document.addEventListener('visibilitychange', () => {
  if (document.hidden) {
    animating = false;
    cancelAnimationFrame(animationId);
  } else {
    animating = true;
    animate();
  }
});

window.addEventListener('resize', resize);

resize();
animate();
