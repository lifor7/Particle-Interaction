// ============================================================
//  粒子交互 — 进阶特效拓展模块
//  Particle Interaction — Advanced Effects Extension
//
//  使用方式：在 index.html 中于 particle.js 之后引入本文件：
//    <script src="particle.js"></script>
//    <script src="particle-advanced.js"></script>
//
//  每个特效为独立函数，按需调用即可启用，互不冲突。
//  所有函数均依赖 particle.js 中的 CONFIG / particles / canvas / ctx。
// ============================================================

// ═══════════════════════════════════════════════════════════
//  特效 1：鼠标跟随拖尾粒子（Cursor Trail Particles）
//
//  效果：鼠标移动时沿轨迹生成小型高亮粒子，模拟光标划过
//        留下光屑残影的视觉效果。
//  性能：粒子总数上限 60，自动清理超量旧粒子，几乎不影响帧率。
// ═══════════════════════════════════════════════════════════

const CursorTrail = {
  enabled: false,
  particles: [],             // 拖尾专用粒子池
  maxParticles: 60,          // 上限防止堆积
  emitCooldown: 0,           // 生成冷却计数器
  emitInterval: 2,           // 每 N 帧生成一个粒子（2 = 30个/秒 @60fps）
  particleLife: 40,          // 拖尾粒子生命周期（帧）
  lastX: -1000,
  lastY: -1000,

  /** 每帧调用：在 animate() 中 mouse glow 之后调用 */
  update(mx, my) {
    if (!this.enabled) return;
    if (mx < 0 || my < 0) {
      this.particles.length = 0;
      return;
    }

    // 冷却计时
    this.emitCooldown--;
    if (this.emitCooldown <= 0) {
      this.emitCooldown = this.emitInterval;
      // 限制总量
      if (this.particles.length >= this.maxParticles) {
        this.particles.shift();
      }
      // 生成新拖尾粒子：较小尺寸、偏白色相、短生命周期
      this.particles.push({
        x: mx + (Math.random() - 0.5) * 6,
        y: my + (Math.random() - 0.5) * 6,
        vx: (Math.random() - 0.5) * 0.8,
        vy: (Math.random() - 0.5) * 0.8 - 1.2, // 略微上飘
        radius: Math.random() * 1.5 + 0.8,
        hue: 195 + Math.random() * 30,           // 偏青白色相
        life: this.particleLife,
        maxLife: this.particleLife,
      });
    }

    // 更新 + 绘制
    for (let i = this.particles.length - 1; i >= 0; i--) {
      const tp = this.particles[i];
      tp.x += tp.vx;
      tp.y += tp.vy;
      tp.vy -= 0.02; // 轻微上升加速度
      tp.life--;

      const alpha = Math.max(0, (tp.life / tp.maxLife) * 0.7);
      const r = tp.radius * (tp.life / tp.maxLife);

      ctx.beginPath();
      ctx.arc(tp.x, tp.y, r, 0, Math.PI * 2);
      ctx.fillStyle = `hsla(${tp.hue}, 70%, 75%, ${alpha})`;
      ctx.fill();

      if (tp.life <= 0) this.particles.splice(i, 1);
    }

    this.lastX = mx;
    this.lastY = my;
  },
};

// ═══════════════════════════════════════════════════════════
//  特效 2：缓慢流动渐变背景（Flowing Gradient Background）
//
//  效果：全屏 HSL 渐变背景色相随时间缓慢旋转，产生流动感。
//        叠加在粒子层之下，与蓝色系粒子搭配和谐。
//  实现：使用 canvas 全屏线性渐变，色相角度按帧微调。
// ═══════════════════════════════════════════════════════════

const FlowingBackground = {
  enabled: false,
  hueOffset: 0,              // 当前色相偏移
  speed: 0.08,               // 每帧旋转速度（°）

  /** 每帧在 drawTrailOverlay() 之后调用（覆盖拖尾背景，作为底层） */
  draw() {
    if (!this.enabled) return;

    this.hueOffset = (this.hueOffset + this.speed) % 360;

    // 双色渐变：左上 → 右下，色相随 hueOffset 缓慢变化
    const h1 = (210 + this.hueOffset) % 360;  // 蓝
    const h2 = (260 + this.hueOffset) % 360;  // 紫

    const gradient = ctx.createLinearGradient(0, 0, width, height);
    gradient.addColorStop(0, `hsla(${h1}, 50%, 8%, 1)`);
    gradient.addColorStop(0.5, `hsla(${(h1 + h2) / 2}, 45%, 6%, 1)`);
    gradient.addColorStop(1, `hsla(${h2}, 50%, 10%, 1)`);

    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, width, height);
  },
};

// ═══════════════════════════════════════════════════════════
//  特效 3：粒子碰撞物理（Particle Collision Physics）
//
//  效果：粒子间互相碰撞，交换动量（弹性碰撞模型）。
//        粒子靠近到一定距离时互相弹开，同时轻微交换速度。
//  注意：启用后每帧 O(n²) 碰撞检测，粒子数较多时影响性能。
//        建议配合空间网格使用，或仅在粒子数 < 100 时开启。
// ═══════════════════════════════════════════════════════════

const CollisionPhysics = {
  enabled: false,
  collisionRadius: 4,        // 碰撞检测半径（两粒子半径之和 < 此值触发）
  restitution: 0.7,          // 弹性系数（1=完全弹性, 0=完全非弹性）
  damping: 0.9,              // 碰撞后速度衰减

  /**
   * 每帧在粒子 update() 之后、draw() 之前调用
   * 使用双重循环检测碰撞，粒子数多时建议使用空间网格优化
   */
  update() {
    if (!this.enabled) return;

    const len = particles.length;
    for (let i = 0; i < len; i++) {
      for (let j = i + 1; j < len; j++) {
        const a = particles[i];
        const b = particles[j];

        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const dist = Math.hypot(dx, dy);
        const minDist = this.collisionRadius + a.radius + b.radius;

        if (dist < minDist && dist > 0) {
          // 法向单位向量
          const nx = dx / dist;
          const ny = dy / dist;

          // 切向单位向量
          const tx = -ny;
          const ty = nx;

          // 速度在法向和切向的分量
          const vaN = a.vx * nx + a.vy * ny;
          const vaT = a.vx * tx + a.vy * ty;
          const vbN = b.vx * nx + b.vy * ny;
          const vbT = b.vx * tx + b.vy * ty;

          // 质量近似为半径平方（大粒子更重）
          const ma = a.radius * a.radius;
          const mb = b.radius * b.radius;
          const massSum = ma + mb;

          // 一维弹性碰撞公式（仅法向分量交换）
          const vaNAfter = (vaN * (ma - mb) + 2 * mb * vbN) / massSum;
          const vbNAfter = (vbN * (mb - ma) + 2 * ma * vaN) / massSum;

          // 应用弹性系数和阻尼
          a.vx = (vaNAfter * nx + vaT * tx) * this.restitution * this.damping;
          a.vy = (vaNAfter * ny + vaT * ty) * this.restitution * this.damping;
          b.vx = (vbNAfter * nx + vbT * tx) * this.restitution * this.damping;
          b.vy = (vbNAfter * ny + vbT * ty) * this.restitution * this.damping;

          // 分离重叠粒子（防止粘在一起）
          const overlap = (minDist - dist) / 2;
          const sepX = nx * overlap;
          const sepY = ny * overlap;
          a.x -= sepX;
          a.y -= sepY;
          b.x += sepX;
          b.y += sepY;
        }
      }
    }
  },
};

// ═══════════════════════════════════════════════════════════
//  特效 4：文字拆解粒子（Text to Particles）
//
//  效果：在画布中央渲染一行文字，每个文字由密集的粒子
//        组成。鼠标靠近时粒子被打散飞出，远离时自动归位。
//  原理：将文字先绘制到离屏 canvas，读取像素找出"非透明点"，
//        每个点对应一个固定目标坐标的粒子。引力模式下粒子
//        始终被拉回目标位置（磁吸效果），斥力模式下被推开。
// ═══════════════════════════════════════════════════════════

const TextParticles = {
  enabled: false,
  text: 'HELLO',              // 要显示的文字
  fontSize: 80,               // 字号 (px)
  fontFamily: 'Arial, sans-serif',
  textColor: '#ffffff',
  sampleStep: 3,              // 采样间隔（px），越小粒子越密
  returnStrength: 0.03,       // 粒子归位磁吸力
  scatterRadius: 250,         // 鼠标打散半径 (px)
  scatterStrength: 1.2,       // 打散力度
  textParticles: [],          // 文字粒子专用数组
  targetX: 0,                 // 文字区域居中 X
  targetY: 0,

  /**
   * 初始化文字粒子（在 resize() 后调用）
   * 使用离屏 canvas 渲染文字 → 逐像素采样 → 生成粒子坐标
   */
  init() {
    if (!this.enabled) return;

    this.textParticles = [];
    const offCanvas = document.createElement('canvas');
    const offCtx = offCanvas.getContext('2d');

    // 设置离屏 canvas 尺寸
    offCanvas.width = width * dpr;
    offCanvas.height = height * dpr;
    offCtx.scale(dpr, dpr);

    // 渲染文字
    offCtx.fillStyle = this.textColor;
    offCtx.font = `bold ${this.fontSize}px ${this.fontFamily}`;
    offCtx.textAlign = 'center';
    offCtx.textBaseline = 'middle';

    const textX = width / 2;
    const textY = height / 2;
    offCtx.fillText(this.text, textX, textY);

    // 采样像素，找出文字轮廓内的点
    const imageData = offCtx.getImageData(0, 0, offCanvas.width, offCanvas.height);
    const pixels = imageData.data;

    for (let y = 0; y < height; y += this.sampleStep) {
      for (let x = 0; x < width; x += this.sampleStep) {
        const idx = ((y * dpr) | 0) * (offCanvas.width) + ((x * dpr) | 0);
        const alpha = pixels[idx * 4 + 3];
        if (alpha > 128) {
          this.textParticles.push({
            targetX: x,
            targetY: y,
            currentX: x + (Math.random() - 0.5) * 200,
            currentY: y + (Math.random() - 0.5) * 200,
            vx: 0,
            vy: 0,
            radius: 1.0 + Math.random() * 0.8,
            hue: 195 + Math.random() * 40,
          });
        }
      }
    }
  },

  /**
   * 每帧更新文字粒子（在 animate 循环末尾调用）
   * 每个粒子被拉回目标位置，鼠标靠近时被打散
   */
  update() {
    if (!this.enabled || this.textParticles.length === 0) return;

    for (let i = 0; i < this.textParticles.length; i++) {
      const tp = this.textParticles[i];

      // 磁吸：始终被拉回目标位置
      const dxTarget = tp.targetX - tp.currentX;
      const dyTarget = tp.targetY - tp.currentY;
      tp.vx += dxTarget * this.returnStrength;
      tp.vy += dyTarget * this.returnStrength;

      // 鼠标打散
      if (mouseX > 0 && mouseY > 0) {
        const dxMouse = tp.currentX - mouseX;
        const dyMouse = tp.currentY - mouseY;
        const distMouse = Math.hypot(dxMouse, dyMouse);

        if (distMouse < this.scatterRadius && distMouse > 0) {
          const force = (1 - distMouse / this.scatterRadius) * this.scatterStrength;
          tp.vx += (dxMouse / distMouse) * force;
          tp.vy += (dyMouse / distMouse) * force;
        }
      }

      // 阻尼
      tp.vx *= 0.92;
      tp.vy *= 0.92;

      // 更新位置
      tp.currentX += tp.vx;
      tp.currentY += tp.vy;

      // 绘制
      ctx.beginPath();
      ctx.arc(tp.currentX, tp.currentY, tp.radius, 0, Math.PI * 2);
      ctx.fillStyle = `hsla(${tp.hue}, 75%, 60%, 0.85)`;
      ctx.fill();
    }
  },
};

// ═══════════════════════════════════════════════════════════
//  集成示例：修改 animate() 函数启用特效
//
//  在 particle.js 的 animate() 函数中插入以下调用即可：
//
//  function animate() {
//    if (!animating) return;
//
//    // 流动渐变背景（替代 drawTrailOverlay 作为背景层）
//    FlowingBackground.draw();
//    // 保留拖尾覆盖（与渐变叠加）
//    drawTrailOverlay();
//
//    drawMouseGlow();
//
//    // 鼠标拖尾粒子（在光晕之后、连线之前）
//    CursorTrail.update(mouseX, mouseY);
//
//    drawConnections();
//
//    for (let i = 0; i < particles.length; i++) {
//      const p = particles[i];
//      p.applyMouseForce(mouseX, mouseY);
//      p.update();
//      p.draw();
//    }
//
//    // 粒子碰撞物理（在位置更新之后）
//    CollisionPhysics.update();
//
//    // 文字粒子（在最上层绘制）
//    TextParticles.update();
//
//    removeDeadParticles();
//    animationId = requestAnimationFrame(animate);
//  }
//
//  // 启用特效（在 resize() animate() 调用之前设置）：
//  CursorTrail.enabled = true;
//  FlowingBackground.enabled = true;
//  CollisionPhysics.enabled = true;
//  TextParticles.enabled = true;
//  // 文字粒子需要在 resize 后初始化：
//  // 在 resize() 函数末尾添加：TextParticles.init();
//
// ═══════════════════════════════════════════════════════════
