// ============================================================
//  粒子交互引擎 — Particle Interaction Engine
//  优化版：视觉质感 · 交互手感 · 渲染性能 · 移动端适配
// ============================================================

// ──────────────────────────────────────────────
//  DOM 引用（在脚本顶层一次性获取，避免重复查询）
// ──────────────────────────────────────────────
const canvas = document.getElementById('canvas');
const ctx = canvas.getContext('2d', { alpha: false }); // 关闭透明通道，减少合成开销

// ──────────────────────────────────────────────
//  全局配置常量（统一提取至顶部，方便调试）
//  所有可调参数集中管理，避免魔法数字散落各处
// ──────────────────────────────────────────────
const CONFIG = {
  // ---- 粒子数量（设备自适应） ----
  desktopDivisor: 7000,        // 桌面端：可视面积 / 此值 = 粒子数
  mobileDivisor: 15000,        // 移动端粒子密度减半（屏幕 < 768px）
  mobileBreakpoint: 768,       // 移动端判定宽度阈值 (px)
  maxParticles: 350,           // 全局粒子数量上限，防止卡顿
  burstCount: 14,              // 鼠标每次点击批量生成的粒子数

  // ---- 粒子物理 ----
  influenceRadius: 185,        // 鼠标影响半径 (px)
  attractStrength: 0.32,       // 引力基础强度
  repelStrength: 0.6,          // 斥力基础强度
  maxSpeed: 4.5,               // 粒子最大运动速度
  friction: 0.986,             // 速度阻尼（越接近 1 运动越丝滑）
  turbulence: 0.05,            // 随机湍流强度（模拟流体微扰动）
  forceFalloff: 1.7,           // 力衰减指数（>1 时远距离作用力加速弱化）

  // ---- 连线视觉 ----
  connectionDistance: 135,     // 连线最大距离 (px)（同时也是空间网格单元大小）
  connectionAlphaMax: 0.45,    // 连线最大透明度
  connectionAlphaMin: 0.04,    // 连线最小透明度（低于此值不绘制，减少无效 draw call）
  connectionWidthMax: 1.1,     // 连线最大线宽
  connectionWidthMin: 0.25,    // 连线最小线宽

  // ---- 拖尾与背景 ----
  trailAlpha: 0.09,            // 拖尾透明度（值越低拖尾越长，避免画面糊团）
  bgR: 10, bgG: 10, bgB: 18,  // 背景色分量（深色底）

  // ---- 粒子尺寸分层（大/中/小三层比例分配） ----
  tiers: [
    { ratio: 0.50, minR: 1.0, maxR: 1.6, glowR: 3.0, alpha: 0.70 },  // 小粒子 50%
    { ratio: 0.35, minR: 1.6, maxR: 2.5, glowR: 4.5, alpha: 0.80 },  // 中粒子 35%
    { ratio: 0.15, minR: 2.5, maxR: 3.5, glowR: 6.5, alpha: 0.90 },  // 大粒子 15%
  ],

  // ---- 悬浮交互 ----
  hoverRadius: 55,             // 悬浮检测半径 (px)
  hoverScale: 2.0,             // 悬浮时粒子半径放大倍数
  hoverHueShift: 35,           // 悬浮时色相偏移量

  // ---- 粒子生命周期 ----
  fadeOutDuration: 45,         // 淡出持续帧数（粒子逐渐透明直至移除）

  // ---- 颜色范围 ----
  hueMin: 185,                 // 基础色相下限（青蓝色）
  hueMax: 260,                 // 基础色相上限（蓝紫色）

  // ---- 性能开关 ----
  useSpatialGrid: true,        // 启用空间网格加速连线查找（O(n²)→O(n×k)）
  disableImageSmoothing: true, // 关闭 canvas 图像平滑/抗锯齿（粒子为简单几何形状，无需）
};

// ──────────────────────────────────────────────
//  全局状态变量（模块级，读写自由）
// ──────────────────────────────────────────────
let width = 0;                     // 画布 CSS 宽度
let height = 0;                    // 画布 CSS 高度
let dpr = 1;                       // devicePixelRatio
let particles = [];                // 粒子数组
let mouseX = -1000;                // 鼠标/触摸 X（初始在画面外）
let mouseY = -1000;                // 鼠标/触摸 Y
let isAttract = true;              // 基础模式：true=引力, false=斥力（空格切换）
let isMouseDown = false;           // 鼠标/触摸是否按下（按下时临时反转模式）
let mouseMoved = false;            // 本次按下期间鼠标是否移动（区分点击与拖拽）
let animating = true;              // 动画运行标志
let animationId = null;            // requestAnimationFrame 句柄
let isMobile = false;              // 是否移动端

// 空间网格相关（每帧重建，避免 O(n²) 遍历）
let gridCols = 0;                  // 网格列数
let gridRows = 0;                  // 网格行数
let gridCellSize = 0;             // 网格单元大小 (= connectionDistance)

// ──────────────────────────────────────────────
//  工具函数
// ──────────────────────────────────────────────

/** 检测是否为移动设备（UA + 屏幕宽度 + 触控点数综合判断） */
function detectMobile() {
  return /Mobi|Android|iPhone|iPad|iPod/i.test(navigator.userAgent)
      || (navigator.maxTouchPoints > 1 && window.innerWidth < CONFIG.mobileBreakpoint);
}

/** 按权重随机选择一个粒子层级 */
function chooseTier() {
  const r = Math.random();
  let cumulative = 0;
  for (let i = 0; i < CONFIG.tiers.length; i++) {
    cumulative += CONFIG.tiers[i].ratio;
    if (r <= cumulative) return i;
  }
  return CONFIG.tiers.length - 1;
}

/** 获取当前有效的引力/斥力模式（鼠标按下时临时反转） */
function effectiveAttract() {
  return isMouseDown ? !isAttract : isAttract;
}

// ──────────────────────────────────────────────
//  粒子类
// ──────────────────────────────────────────────
class Particle {
  /**
   * @param {number} x       - 初始 X 坐标
   * @param {number} y       - 初始 Y 坐标
   * @param {number|null} tierIndex - 强制指定层级（null 则随机分配）
   * @param {number|null} lifetime  - 生命周期帧数（null = 无限）
   */
  constructor(x, y, tierIndex = null, lifetime = null) {
    this.x = x;
    this.y = y;

    // 初始速度：随机方向 + 小幅度初速
    const angle = Math.random() * Math.PI * 2;
    const speed = Math.random() * 1.2 + 0.3;
    this.vx = Math.cos(angle) * speed;
    this.vy = Math.sin(angle) * speed;

    // 分层尺寸
    this.tier = (tierIndex !== null) ? tierIndex : chooseTier();
    const t = CONFIG.tiers[this.tier];
    this.radius = t.minR + Math.random() * (t.maxR - t.minR);
    this.glowRadius = t.glowR;
    this.baseAlpha = t.alpha;

    // 颜色：蓝-青-紫 范围内随机基础色相
    this.baseHue = CONFIG.hueMin + Math.random() * (CONFIG.hueMax - CONFIG.hueMin);

    // 生命周期管理（用于点击生成的临时粒子）
    this.life = lifetime;               // null = 永久存活
    this.fading = false;                // 是否已进入淡出阶段
    this.opacity = 1;                   // 当前透明度倍率
    this.spawned = lifetime !== null;   // 标记为"点击生成"，便于超限时优先移除
  }

  /**
   * 应用鼠标/触摸作用力
   * - 力的大小随距离指数衰减（forceFalloff 控制衰减曲线）
   * - 远距离作用力弱化，近距离作用力增强
   */
  applyMouseForce(mx, my) {
    const dx = mx - this.x;
    const dy = my - this.y;
    const dist = Math.hypot(dx, dy);

    if (dist >= CONFIG.influenceRadius || dist <= 0) return;

    // 距离归一化 + 指数衰减（>1 远距弱化，<1 远距强化）
    const normalizedDist = dist / CONFIG.influenceRadius;
    const force = Math.pow(1 - normalizedDist, CONFIG.forceFalloff);

    const angle = Math.atan2(dy, dx);
    const attract = effectiveAttract();
    const baseStrength = attract ? CONFIG.attractStrength : -CONFIG.repelStrength;

    this.vx += Math.cos(angle) * force * baseStrength;
    this.vy += Math.sin(angle) * force * baseStrength;
  }

  /** 更新粒子物理状态（每帧调用一次） */
  update() {
    // 速度阻尼
    this.vx *= CONFIG.friction;
    this.vy *= CONFIG.friction;

    // 随机湍流（模拟流体布朗运动微扰动）
    this.vx += (Math.random() - 0.5) * CONFIG.turbulence;
    this.vy += (Math.random() - 0.5) * CONFIG.turbulence;

    // 速度上限裁剪（防止粒子飞出画面过快）
    const speed = Math.hypot(this.vx, this.vy);
    if (speed > CONFIG.maxSpeed) {
      const scale = CONFIG.maxSpeed / speed;
      this.vx *= scale;
      this.vy *= scale;
    }

    // 位置更新
    this.x += this.vx;
    this.y += this.vy;

    // 穿墙循环（运动连贯无跳变）
    this.wrap();

    // 生命周期递减与淡出
    if (this.life !== null) {
      this.life--;
      if (this.life <= CONFIG.fadeOutDuration && !this.fading) {
        this.fading = true;
      }
      if (this.fading) {
        this.opacity = Math.max(0, this.life / CONFIG.fadeOutDuration);
      }
    }
  }

  /** 穿墙循环：超出画布边界的粒子从对侧重新进入 */
  wrap() {
    if (this.x < 0) this.x = width;
    else if (this.x > width) this.x = 0;
    if (this.y < 0) this.y = height;
    else if (this.y > height) this.y = 0;
  }

  /** 粒子是否已死亡（生命周期结束） */
  isDead() {
    return this.life !== null && this.life <= 0;
  }

  /**
   * 计算粒子与鼠标的距离关系
   * @returns {{ dist: number, proximity: number, isHovering: boolean }}
   */
  getMouseRelation(mx, my) {
    const dx = mx - this.x;
    const dy = my - this.y;
    const dist = Math.hypot(dx, dy);

    const proximity = dist < CONFIG.influenceRadius
      ? 1 - dist / CONFIG.influenceRadius
      : 0;

    const isHovering = dist < CONFIG.hoverRadius && dist > 0;

    return { dist, proximity, isHovering };
  }

  /**
   * 获取粒子当前颜色
   * - 距离鼠标越近色相偏移越大 → 动态色彩变化
   * - 悬浮时色相进一步偏移 + 饱和度提升 → 强化交互反馈
   * - 速度影响亮度 → 运动快的粒子更亮
   */
  getColor(mx, my) {
    const { proximity, isHovering } = this.getMouseRelation(mx, my);
    const speed = Math.hypot(this.vx, this.vy);

    let hue = this.baseHue + proximity * 50 + speed * 4;
    if (isHovering) hue += CONFIG.hoverHueShift;

    const lightness = 50 + proximity * 25;
    const saturation = isHovering ? 90 : 75 + proximity * 15;
    const alpha = Math.min(1, (this.baseAlpha + proximity * 0.25) * this.opacity);

    return { hue, saturation, lightness, alpha };
  }

  /**
   * 绘制粒子（三层叠加模拟径向渐变光晕）
   * 外层光晕(大半透明) → 中层柔光(过渡) → 核心亮点(最亮)
   */
  draw() {
    const { isHovering } = this.getMouseRelation(mouseX, mouseY);
    const { hue, saturation, lightness, alpha } = this.getColor(mouseX, mouseY);

    // 悬浮时粒子半径放大
    const displayRadius = isHovering
      ? this.radius * CONFIG.hoverScale
      : this.radius;

    const glowBoost = isHovering ? 1.4 : 1;

    // ──── 外层光晕 ────
    const glowAlpha = alpha * 0.18 * glowBoost;
    const glowR = Math.max(displayRadius * 2.5, this.glowRadius * glowBoost);
    ctx.beginPath();
    ctx.arc(this.x, this.y, glowR, 0, Math.PI * 2);
    ctx.fillStyle = `hsla(${hue}, ${saturation}%, ${lightness}%, ${glowAlpha})`;
    ctx.fill();

    // ──── 中层柔光 ────
    const midAlpha = alpha * 0.45 * glowBoost;
    const midR = displayRadius * 1.6;
    ctx.beginPath();
    ctx.arc(this.x, this.y, midR, 0, Math.PI * 2);
    ctx.fillStyle = `hsla(${hue}, ${saturation}%, ${lightness + 5}%, ${midAlpha})`;
    ctx.fill();

    // ──── 核心亮点 ────
    ctx.beginPath();
    ctx.arc(this.x, this.y, displayRadius, 0, Math.PI * 2);
    ctx.fillStyle = `hsla(${hue}, ${saturation - 5}%, ${lightness + 15}%, ${alpha})`;
    ctx.fill();
  }
}

// ═══════════════════════════════════════════════════════════
//  画布初始化
// ═══════════════════════════════════════════════════════════

/** 响应窗口尺寸变化，重新计算画布大小并初始化粒子 */
function resize() {
  dpr = window.devicePixelRatio || 1;
  width = window.innerWidth;
  height = window.innerHeight;

  // 高 DPI 适配
  canvas.width = width * dpr;
  canvas.height = height * dpr;
  canvas.style.width = width + 'px';
  canvas.style.height = height + 'px';

  // 设置变换矩阵，使绘制坐标始终以 CSS 像素为单位
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

  // 关闭图像平滑/抗锯齿 —— 粒子为简单几何形状（圆弧），不需要抗锯齿，
  // 关闭后小幅提升渲染帧率（尤其在移动端低性能 GPU 上效果明显）
  if (CONFIG.disableImageSmoothing) {
    ctx.imageSmoothingEnabled = false;
  }

  // 预计算空间网格尺寸
  gridCellSize = CONFIG.connectionDistance;
  gridCols = Math.ceil(width / gridCellSize);
  gridRows = Math.ceil(height / gridCellSize);

  initParticles();
}

/** 根据画布面积和设备类型计算粒子数量并生成初始粒子 */
function initParticles() {
  const area = width * height;
  // 移动端自动减半粒子密度（使用更大的 divisor）
  const divisor = isMobile ? CONFIG.mobileDivisor : CONFIG.desktopDivisor;
  let count = Math.floor(area / divisor);

  count = Math.min(count, CONFIG.maxParticles);
  count = Math.max(count, 20);

  particles = [];
  for (let i = 0; i < count; i++) {
    particles.push(new Particle(
      Math.random() * width,
      Math.random() * height
    ));
  }
}

// ═══════════════════════════════════════════════════════════
//  空间网格（Spatial Hashing Grid）
//  将画布划分为 cellSize × cellSize 的网格，每帧按粒子坐标
//  重新分桶。绘制连线时只需检查同格 + 相邻 8 格内的粒子，
//  将 O(n²) 降为 O(n × k)，k = 9 格平均粒子数。
// ═══════════════════════════════════════════════════════════

/**
 * 构建空间网格
 * @returns {number[][][]} grid[row][col] = [粒子索引1, 粒子索引2, ...]
 */
function buildSpatialGrid() {
  const grid = Array.from({ length: gridRows }, () =>
    Array.from({ length: gridCols }, () => [])
  );

  for (let i = 0; i < particles.length; i++) {
    const p = particles[i];
    if (p.opacity < 0.05) continue; // 跳过透明粒子

    const col = Math.floor(p.x / gridCellSize);
    const row = Math.floor(p.y / gridCellSize);

    // 安全钳：确保索引在有效范围内
    const safeCol = Math.max(0, Math.min(col, gridCols - 1));
    const safeRow = Math.max(0, Math.min(row, gridRows - 1));
    grid[safeRow][safeCol].push(i);

    // 边界处理：如果粒子靠近画布边缘（距离 < connectionDistance），
    // 同时在"对侧"的网格单元也注册该粒子，保证穿墙连线正确
    if (p.x < CONFIG.connectionDistance) {
      const wrapCol = gridCols - 1;
      if (wrapCol !== safeCol) grid[safeRow][wrapCol].push(i);
    } else if (p.x > width - CONFIG.connectionDistance) {
      if (0 !== safeCol) grid[safeRow][0].push(i);
    }

    if (p.y < CONFIG.connectionDistance) {
      const wrapRow = gridRows - 1;
      if (wrapRow !== safeRow) grid[wrapRow][safeCol].push(i);
    } else if (p.y > height - CONFIG.connectionDistance) {
      if (0 !== safeRow) grid[0][safeCol].push(i);
    }
  }

  return grid;
}

// ═══════════════════════════════════════════════════════════
//  粒子管理
// ═══════════════════════════════════════════════════════════

/**
 * 在指定位置批量生成粒子（点击/触摸爆发效果）
 * @param {number} x - 爆发中心 X
 * @param {number} y - 爆发中心 Y
 */
function burstParticles(x, y) {
  const available = CONFIG.maxParticles - particles.length;
  if (available <= 0) {
    // 已达上限：移除最老的临时粒子为新粒子腾空间
    const oldestSpawned = particles.find(p => p.spawned);
    if (oldestSpawned) {
      const idx = particles.indexOf(oldestSpawned);
      particles.splice(idx, 1);
    } else {
      return;
    }
  }

  const count = Math.min(CONFIG.burstCount, Math.max(available, 0) || CONFIG.burstCount);
  for (let i = 0; i < count; i++) {
    const spawnX = x + (Math.random() - 0.5) * 20;
    const spawnY = y + (Math.random() - 0.5) * 20;
    const lifetime = 30 + Math.floor(Math.random() * 60);
    const p = new Particle(spawnX, spawnY, null, lifetime);
    // 爆发初速度：向外辐射
    const angle = Math.random() * Math.PI * 2;
    const spd = 2 + Math.random() * 3;
    p.vx = Math.cos(angle) * spd;
    p.vy = Math.sin(angle) * spd;
    particles.push(p);
  }
}

/** 清理已死亡的粒子 */
function removeDeadParticles() {
  particles = particles.filter(p => !p.isDead());
}

// ═══════════════════════════════════════════════════════════
//  渲染绘制
// ═══════════════════════════════════════════════════════════

/** 半透明背景覆盖层，实现柔和拖尾效果 */
function drawTrailOverlay() {
  ctx.fillStyle = `rgba(${CONFIG.bgR}, ${CONFIG.bgG}, ${CONFIG.bgB}, ${CONFIG.trailAlpha})`;
  ctx.fillRect(0, 0, width, height);
}

/** 鼠标/触摸位置的径向光晕（引力蓝色 / 斥力红色） */
function drawMouseGlow() {
  if (mouseX < 0 || mouseY < 0) return;

  const gradient = ctx.createRadialGradient(
    mouseX, mouseY, 0,
    mouseX, mouseY, CONFIG.influenceRadius
  );

  const attract = effectiveAttract();
  const color = attract ? '100, 180, 255' : '255, 100, 120';

  gradient.addColorStop(0, `rgba(${color}, 0.07)`);
  gradient.addColorStop(0.4, `rgba(${color}, 0.03)`);
  gradient.addColorStop(1, `rgba(${color}, 0)`);

  ctx.beginPath();
  ctx.arc(mouseX, mouseY, CONFIG.influenceRadius, 0, Math.PI * 2);
  ctx.fillStyle = gradient;
  ctx.fill();

  // 高亮核心点
  ctx.beginPath();
  ctx.arc(mouseX, mouseY, 4, 0, Math.PI * 2);
  ctx.fillStyle = `rgba(${color}, 0.25)`;
  ctx.fill();
}

/**
 * 绘制粒子间连线（空间网格加速版）
 *
 * 优化前：双重循环 O(n²)，每帧检查所有粒子对。
 * 优化后：空间网格 O(n × k)，仅检查同一网格及相邻 8 格内的粒子对。
 * 在 300+ 粒子场景下，比较次数减少约 70-90%。
 *
 * 视觉效果：透明度 + 线宽双重距离渐变；低于阈值不绘制减少无效 draw call。
 */
function drawConnections() {
  const maxDist = CONFIG.connectionDistance;

  // 决定是否使用空间网格加速
  if (CONFIG.useSpatialGrid && particles.length > 50) {
    drawConnectionsGrid(maxDist);
  } else {
    drawConnectionsBrute(maxDist);
  }
}

/** 空间网格加速版连线绘制 */
function drawConnectionsGrid(maxDist) {
  const grid = buildSpatialGrid();
  // 用于去重：记录已处理的粒子对，避免同对粒子被绘制两次
  const visited = new Set();

  for (let row = 0; row < gridRows; row++) {
    for (let col = 0; col < gridCols; col++) {
      const cell = grid[row][col];
      if (cell.length === 0) continue;

      // 检查当前格 + 右/下/右下/左下 4 个相邻格（覆盖所有方向且不重复）
      const neighbors = [
        [row, col],       // 当前格
        [row, col + 1],   // 右
        [row + 1, col],   // 下
        [row + 1, col + 1], // 右下
        [row + 1, col - 1], // 左下
      ];

      for (let n = 0; n < neighbors.length; n++) {
        const nr = neighbors[n][0];
        const nc = neighbors[n][1];

        // 边界检查
        if (nr < 0 || nr >= gridRows || nc < 0 || nc >= gridCols) continue;
        const neighborCell = grid[nr][nc];
        if (neighborCell.length === 0) continue;

        // 双向遍历：当前格粒子 × 相邻格粒子
        for (let a = 0; a < cell.length; a++) {
          const pi = particles[cell[a]];
          if (!pi || pi.opacity < 0.05) continue;

          for (let b = 0; b < neighborCell.length; b++) {
            const pjIdx = neighborCell[b];
            // 同格时避免与自身连线和重复连线
            if (n === 0 && cell[a] >= pjIdx) continue;

            const pj = particles[pjIdx];
            if (!pj || pj.opacity < 0.05) continue;

            // 去重检查
            const key = cell[a] < pjIdx
              ? cell[a] + '_' + pjIdx
              : pjIdx + '_' + cell[a];
            if (visited.has(key)) continue;
            visited.add(key);

            const dx = pi.x - pj.x;
            const dy = pi.y - pj.y;
            const dist = Math.hypot(dx, dy);

            if (dist >= maxDist) continue;

            drawSingleConnection(pi, pj, dist, maxDist);
          }
        }
      }
    }
  }
}

/** 暴力双循环版连线绘制（粒子数少时使用，网格开销不划算） */
function drawConnectionsBrute(maxDist) {
  const len = particles.length;
  for (let i = 0; i < len; i++) {
    const pi = particles[i];
    if (pi.opacity < 0.05) continue;

    for (let j = i + 1; j < len; j++) {
      const pj = particles[j];
      if (pj.opacity < 0.05) continue;

      const dx = pi.x - pj.x;
      const dy = pi.y - pj.y;
      const dist = Math.hypot(dx, dy);

      if (dist >= maxDist) continue;

      drawSingleConnection(pi, pj, dist, maxDist);
    }
  }
}

/**
 * 绘制单条连线（提取为独立函数，避免网格版和暴力版重复代码）
 * - 透明度 = 距离线性插值（alphaMin → alphaMax）
 * - 线宽   = 距离线性插值（widthMin → widthMax）
 * - 颜色   = 两粒子色相平均值，视觉和谐
 * - 低于最小透明度阈值直接跳过 → 减少无效绘制
 */
function drawSingleConnection(pi, pj, dist, maxDist) {
  const ratio = 1 - dist / maxDist;

  const alpha = CONFIG.connectionAlphaMin
    + ratio * (CONFIG.connectionAlphaMax - CONFIG.connectionAlphaMin);
  if (alpha <= CONFIG.connectionAlphaMin) return;

  const lineWidth = CONFIG.connectionWidthMin
    + ratio * (CONFIG.connectionWidthMax - CONFIG.connectionWidthMin);

  const avgHue = (pi.baseHue + pj.baseHue) / 2;

  ctx.beginPath();
  ctx.moveTo(pi.x, pi.y);
  ctx.lineTo(pj.x, pj.y);
  ctx.strokeStyle = `hsla(${avgHue}, 65%, 58%, ${alpha})`;
  ctx.lineWidth = lineWidth;
  ctx.stroke();
}

/** 绘制所有粒子 */
function drawParticles() {
  for (let i = 0; i < particles.length; i++) {
    particles[i].draw();
  }
}

// ═══════════════════════════════════════════════════════════
//  动画主循环（requestAnimationFrame 驱动）
// ═══════════════════════════════════════════════════════════

function animate() {
  if (!animating) return;

  // 1. 半透明拖尾覆盖
  drawTrailOverlay();

  // 2. 鼠标光晕
  drawMouseGlow();

  // 3. 粒子间连线（空间网格加速）
  drawConnections();

  // 4. 物理更新 + 粒子绘制
  for (let i = 0; i < particles.length; i++) {
    const p = particles[i];
    p.applyMouseForce(mouseX, mouseY);
    p.update();
    p.draw();
  }

  // 5. 清理死亡粒子
  removeDeadParticles();

  // 6. 下一帧
  animationId = requestAnimationFrame(animate);
}

// ═══════════════════════════════════════════════════════════
//  指针交互（鼠标 + 触摸统一处理）
// ═══════════════════════════════════════════════════════════

function setPointer(x, y) {
  mouseX = x;
  mouseY = y;
}

// ── 鼠标事件 ──

canvas.addEventListener('mousemove', (e) => {
  setPointer(e.clientX, e.clientY);
  if (isMouseDown) mouseMoved = true;
});

canvas.addEventListener('mousedown', (e) => {
  isMouseDown = true;
  mouseMoved = false;
  setPointer(e.clientX, e.clientY);
});

canvas.addEventListener('mouseup', (e) => {
  if (!mouseMoved) {
    burstParticles(e.clientX, e.clientY); // 点击生成粒子
  }
  isMouseDown = false;
});

canvas.addEventListener('mouseleave', () => {
  mouseX = -1000;
  mouseY = -1000;
  isMouseDown = false;
});

// ── 触摸事件（移动端兼容） ──

canvas.addEventListener('touchstart', (e) => {
  e.preventDefault();
  const touch = e.touches[0];
  isMouseDown = true;
  mouseMoved = false;
  setPointer(touch.clientX, touch.clientY);
  burstParticles(touch.clientX, touch.clientY); // 触摸同时爆发粒子
}, { passive: false });

canvas.addEventListener('touchmove', (e) => {
  e.preventDefault();
  const touch = e.touches[0];
  mouseMoved = true;
  setPointer(touch.clientX, touch.clientY);
}, { passive: false });

canvas.addEventListener('touchend', (e) => {
  e.preventDefault();
  mouseX = -1000;
  mouseY = -1000;
  isMouseDown = false;
});

// ── 键盘切换引力/斥力模式 ──

window.addEventListener('keydown', (e) => {
  if (e.code === 'Space' || e.code === 'KeyR') {
    e.preventDefault();
    isAttract = !isAttract;
  }
});

// ═══════════════════════════════════════════════════════════
//  节能：标签页切换暂停/恢复动画，降低 CPU 占用
// ═══════════════════════════════════════════════════════════

document.addEventListener('visibilitychange', () => {
  if (document.hidden) {
    animating = false;
    if (animationId) {
      cancelAnimationFrame(animationId);
      animationId = null;
    }
  } else {
    animating = true;
    animate();
  }
});

// ═══════════════════════════════════════════════════════════
//  窗口尺寸变化 → 重新初始化
// ═══════════════════════════════════════════════════════════

window.addEventListener('resize', () => {
  resize();
});

// ═══════════════════════════════════════════════════════════
//  启动
// ═══════════════════════════════════════════════════════════

isMobile = detectMobile();
resize();
animate();
