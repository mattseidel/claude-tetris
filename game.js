'use strict';

const COLS = 10;
const ROWS = 20;
const BLOCK = 30;
const TITLE_H = 50; // banda superior del canvas donde se dibuja el título

let COLORS; // paleta activa, la fija applySkin (SKINS[x].colors)

const PIECES = [
  null,
  [[0,0,0,0],[1,1,1,1],[0,0,0,0],[0,0,0,0]], // I
  [[2,2],[2,2]],                               // O
  [[0,3,0],[3,3,3],[0,0,0]],                  // T
  [[0,4,4],[4,4,0],[0,0,0]],                  // S
  [[5,5,0],[0,5,5],[0,0,0]],                  // Z
  [[6,0,0],[6,6,6],[0,0,0]],                  // J
  [[0,0,7],[7,7,7],[0,0,0]],                  // L
  [[8,8,8],[8,0,8],[8,8,8]],                  // N - tuerca 3x3 con hueco
];

const LINE_SCORES = [0, 100, 300, 500, 800];

const canvas = document.getElementById('board');
const ctx = canvas.getContext('2d');
const nextCanvas = document.getElementById('next-canvas');
const nextCtx = nextCanvas.getContext('2d');
const scoreEl = document.getElementById('score');
const linesEl = document.getElementById('lines');
const levelEl = document.getElementById('level');
const overlay = document.getElementById('overlay');
const overlayTitle = document.getElementById('overlay-title');
const overlayScore = document.getElementById('overlay-score');
const restartBtn = document.getElementById('restart-btn');
const themeBtn = document.getElementById('theme-toggle');
const skinSelect = document.getElementById('skin-select');

let themeColors;

function applyTheme(light, persist) {
  if (light) document.documentElement.dataset.theme = 'light';
  else delete document.documentElement.dataset.theme;
  if (persist) {
    try { localStorage.setItem('theme', light ? 'light' : 'dark'); } catch (e) {}
  }
  const style = getComputedStyle(document.documentElement);
  themeColors = {
    grid: style.getPropertyValue('--grid').trim(),
    accent: style.getPropertyValue('--accent').trim(),
    highlight: style.getPropertyValue('--block-highlight').trim(),
  };
  themeBtn.textContent = light ? '☀ Claro' : '☾ Oscuro';
  themeBtn.setAttribute('aria-pressed', String(light));
  themeBtn.setAttribute('aria-label', light ? 'Tema claro activo, cambiar a oscuro' : 'Tema oscuro activo, cambiar a claro');
}

let board, current, next, score, lines, level, paused, gameOver, lastTime, dropAccum, dropInterval, animId;

function createBoard() {
  return Array.from({ length: ROWS }, () => new Array(COLS).fill(0));
}

function randomPiece() {
  const type = Math.floor(Math.random() * 8) + 1;
  const shape = PIECES[type].map(row => [...row]);
  return { type, shape, x: Math.floor(COLS / 2) - Math.floor(shape[0].length / 2), y: 0 };
}

function collide(shape, ox, oy) {
  for (let r = 0; r < shape.length; r++) {
    for (let c = 0; c < shape[r].length; c++) {
      if (!shape[r][c]) continue;
      const nx = ox + c;
      const ny = oy + r;
      if (nx < 0 || nx >= COLS || ny >= ROWS) return true;
      if (ny >= 0 && board[ny][nx]) return true;
    }
  }
  return false;
}

function rotateCW(shape) {
  const rows = shape.length, cols = shape[0].length;
  const result = Array.from({ length: cols }, () => new Array(rows).fill(0));
  for (let r = 0; r < rows; r++)
    for (let c = 0; c < cols; c++)
      result[c][rows - 1 - r] = shape[r][c];
  return result;
}

function tryRotate() {
  const rotated = rotateCW(current.shape);
  const kicks = [0, -1, 1, -2, 2];
  for (const kick of kicks) {
    if (!collide(rotated, current.x + kick, current.y)) {
      current.shape = rotated;
      current.x += kick;
      return;
    }
  }
}

function merge() {
  for (let r = 0; r < current.shape.length; r++)
    for (let c = 0; c < current.shape[r].length; c++)
      if (current.shape[r][c])
        board[current.y + r][current.x + c] = current.shape[r][c];
}

function clearLines() {
  let cleared = 0;
  for (let r = ROWS - 1; r >= 0; r--) {
    if (board[r].every(v => v !== 0)) {
      board.splice(r, 1);
      board.unshift(new Array(COLS).fill(0));
      cleared++;
      r++;
    }
  }
  if (cleared) {
    lines += cleared;
    score += (LINE_SCORES[cleared] || 0) * level;
    level = Math.floor(lines / 10) + 1;
    dropInterval = Math.max(100, 1000 - (level - 1) * 90);
    updateHUD();
  }
}

function ghostY() {
  let gy = current.y;
  while (!collide(current.shape, current.x, gy + 1)) gy++;
  return gy;
}

function hardDrop() {
  const gy = ghostY();
  score += (gy - current.y) * 2;
  current.y = gy;
  lockPiece();
}

function softDrop() {
  if (!collide(current.shape, current.x, current.y + 1)) {
    current.y++;
    score += 1;
    updateHUD();
  } else {
    lockPiece();
  }
}

function lockPiece() {
  merge();
  clearLines();
  spawn();
}

function spawn() {
  current = next;
  next = randomPiece();
  if (collide(current.shape, current.x, current.y)) {
    endGame();
  }
  drawNext();
}

function updateHUD() {
  scoreEl.textContent = score.toLocaleString();
  linesEl.textContent = lines;
  levelEl.textContent = level;
}

// Skins: colors[] alineado con PIECES (0 = null, 1-8); draw dibuja un bloque en px (x0,y0) de lado size.
function pathRound(g, x, y, w, h, r) {
  g.beginPath();
  if (g.roundRect) { g.roundRect(x, y, w, h, r); return; }
  g.moveTo(x + r, y);
  g.arcTo(x + w, y, x + w, y + h, r);
  g.arcTo(x + w, y + h, x, y + h, r);
  g.arcTo(x, y + h, x, y, r);
  g.arcTo(x, y, x + w, y, r);
  g.closePath();
}

const SKINS = {
  retro: {
    colors: [null, '#4dd0e1', '#ffd54f', '#ba68c8', '#81c784', '#e57373', '#90caf9', '#ffb74d', '#b0bec5'],
    bg: null,
    draw(g, x0, y0, size, color) {
      g.fillStyle = color;
      g.fillRect(x0 + 1, y0 + 1, size - 2, size - 2);
      g.fillStyle = themeColors.highlight;
      g.fillRect(x0 + 1, y0 + 1, size - 2, 4);
    },
  },
  neon: {
    colors: [null, '#00f0ff', '#fff700', '#d500f9', '#39ff14', '#ff1744', '#448aff', '#ff9100', '#e0e0e0'],
    bg: '#000',
    draw(g, x0, y0, size, color) {
      g.shadowColor = color;
      g.shadowBlur = 12;
      g.strokeStyle = color;
      g.lineWidth = 2;
      g.strokeRect(x0 + 3, y0 + 3, size - 6, size - 6);
      g.fillStyle = color;
      g.globalAlpha *= 0.35;
      g.fillRect(x0 + 3, y0 + 3, size - 6, size - 6);
      g.shadowBlur = 0;
      g.shadowColor = 'transparent';
    },
  },
  pastel: {
    colors: [null, '#a8e6ef', '#fff1b8', '#d8b4e8', '#b9e6bf', '#f4b6b6', '#b8d8f5', '#ffd6a5', '#cfd8dc'],
    bg: null,
    draw(g, x0, y0, size, color) {
      pathRound(g, x0 + 2, y0 + 2, size - 4, size - 4, 8);
      g.fillStyle = color;
      g.fill();
      pathRound(g, x0 + 6, y0 + 5, size - 12, 4, 2);
      g.fillStyle = 'rgba(255,255,255,0.55)';
      g.fill();
    },
  },
  pixel: {
    colors: [null, '#29b6f6', '#fdd835', '#ab47bc', '#66bb6a', '#ef5350', '#5c6bc0', '#fb8c00', '#90a4ae'],
    bg: null,
    draw(g, x0, y0, size, color) {
      const u = size / 6; // rejilla 6x6 de "píxeles"
      g.fillStyle = color;
      g.fillRect(x0, y0, size, size);
      g.fillStyle = 'rgba(255,255,255,0.35)'; // luz: borde sup/izq + mota
      g.fillRect(x0, y0, size, u);
      g.fillRect(x0, y0, u, size);
      g.fillRect(x0 + 3 * u, y0 + 2 * u, u, u);
      g.fillStyle = 'rgba(0,0,0,0.35)'; // sombra: borde inf/der + mota
      g.fillRect(x0, y0 + size - u, size, u);
      g.fillRect(x0 + size - u, y0, u, size);
      g.fillRect(x0 + 2 * u, y0 + 3 * u, u, u);
    },
  },
};

let skinName = 'retro';

function applySkin(name, persist) {
  skinName = Object.prototype.hasOwnProperty.call(SKINS, name) ? name : 'retro';
  COLORS = SKINS[skinName].colors;
  skinSelect.value = skinName;
  if (persist) {
    try { localStorage.setItem('skin', skinName); } catch (e) {}
  }
}

function drawBlock(context, x, y, colorIndex, size, alpha) {
  if (!colorIndex) return;
  context.globalAlpha = alpha ?? 1;
  SKINS[skinName].draw(context, x * size, y * size, size, COLORS[colorIndex]);
  context.globalAlpha = 1;
}

function fillSkinBg(g, w, h) {
  if (!SKINS[skinName].bg) return;
  g.fillStyle = SKINS[skinName].bg;
  g.fillRect(0, 0, w, h);
}

function drawGrid() {
  ctx.strokeStyle = themeColors.grid;
  ctx.lineWidth = 0.5;
  for (let c = 1; c < COLS; c++) {
    ctx.beginPath();
    ctx.moveTo(c * BLOCK, 0);
    ctx.lineTo(c * BLOCK, ROWS * BLOCK);
    ctx.stroke();
  }
  for (let r = 1; r < ROWS; r++) {
    ctx.beginPath();
    ctx.moveTo(0, r * BLOCK);
    ctx.lineTo(COLS * BLOCK, r * BLOCK);
    ctx.stroke();
  }
}

function drawTitle() {
  ctx.fillStyle = themeColors.accent;
  ctx.font = '800 32px system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  if ('letterSpacing' in ctx) ctx.letterSpacing = '8px';
  ctx.fillText('TETRIS', canvas.width / 2 + 4, TITLE_H / 2);
  if ('letterSpacing' in ctx) ctx.letterSpacing = '0px';
}

function draw() {
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  fillSkinBg(ctx, canvas.width, canvas.height);
  drawTitle();
  ctx.save();
  ctx.translate(0, TITLE_H);
  drawBoard();
  ctx.restore();
}

function drawBoard() {
  drawGrid();

  // board
  for (let r = 0; r < ROWS; r++)
    for (let c = 0; c < COLS; c++)
      drawBlock(ctx, c, r, board[r][c], BLOCK);

  // ghost
  const gy = ghostY();
  for (let r = 0; r < current.shape.length; r++)
    for (let c = 0; c < current.shape[r].length; c++)
      if (current.shape[r][c])
        drawBlock(ctx, current.x + c, gy + r, current.shape[r][c], BLOCK, 0.2);

  // current piece
  for (let r = 0; r < current.shape.length; r++)
    for (let c = 0; c < current.shape[r].length; c++)
      drawBlock(ctx, current.x + c, current.y + r, current.shape[r][c], BLOCK);
}

function drawNext() {
  const NB = 30;
  nextCtx.clearRect(0, 0, nextCanvas.width, nextCanvas.height);
  fillSkinBg(nextCtx, nextCanvas.width, nextCanvas.height);
  const shape = next.shape;
  const offX = Math.floor((4 - shape[0].length) / 2);
  const offY = Math.floor((4 - shape.length) / 2);
  for (let r = 0; r < shape.length; r++)
    for (let c = 0; c < shape[r].length; c++)
      drawBlock(nextCtx, offX + c, offY + r, shape[r][c], NB);
}

function endGame() {
  gameOver = true;
  cancelAnimationFrame(animId);
  overlayTitle.textContent = 'GAME OVER';
  overlayScore.textContent = `Puntuación: ${score.toLocaleString()}`;
  overlay.classList.remove('hidden');
}

function togglePause() {
  if (gameOver) return;
  paused = !paused;
  if (!paused) {
    lastTime = performance.now();
    loop(lastTime);
  } else {
    cancelAnimationFrame(animId);
    overlayTitle.textContent = 'PAUSA';
    overlayScore.textContent = '';
    overlay.classList.remove('hidden');
  }
}

function loop(ts) {
  const dt = ts - lastTime;
  lastTime = ts;
  dropAccum += dt;
  if (dropAccum >= dropInterval) {
    dropAccum = 0;
    if (!collide(current.shape, current.x, current.y + 1)) {
      current.y++;
    } else {
      lockPiece();
    }
  }
  draw();
  animId = requestAnimationFrame(loop);
}

function init() {
  board = createBoard();
  score = 0;
  lines = 0;
  level = 1;
  paused = false;
  gameOver = false;
  dropInterval = 1000;
  dropAccum = 0;
  lastTime = performance.now();
  next = randomPiece();
  spawn();
  updateHUD();
  overlay.classList.add('hidden');
  cancelAnimationFrame(animId);
  animId = requestAnimationFrame(loop);
}

document.addEventListener('keydown', e => {
  if (e.code === 'KeyP') { togglePause(); return; }
  if (paused || gameOver) return;
  switch (e.code) {
    case 'ArrowLeft':
      if (!collide(current.shape, current.x - 1, current.y)) current.x--;
      break;
    case 'ArrowRight':
      if (!collide(current.shape, current.x + 1, current.y)) current.x++;
      break;
    case 'ArrowDown':
      softDrop();
      break;
    case 'ArrowUp':
    case 'KeyX':
      tryRotate();
      break;
    case 'Space':
      e.preventDefault();
      hardDrop();
      break;
  }
  updateHUD();
});

restartBtn.addEventListener('click', init);

themeBtn.addEventListener('click', () => {
  applyTheme(document.documentElement.dataset.theme !== 'light', true);
  themeBtn.blur(); // evita que Space (caída) active el botón
  // en pausa o game over no hay bucle de dibujo
  if (paused || gameOver) {
    draw();
    drawNext();
  }
});

skinSelect.addEventListener('change', () => {
  applySkin(skinSelect.value, true);
  skinSelect.blur(); // evita que Space (caída) cambie el select
  drawNext(); // el loop no redibuja NEXT
  if (paused || gameOver) draw();
});

applyTheme(document.documentElement.dataset.theme === 'light', false);
let savedSkin = 'retro';
try { savedSkin = localStorage.getItem('skin'); } catch (e) {}
applySkin(savedSkin, false);
init();
