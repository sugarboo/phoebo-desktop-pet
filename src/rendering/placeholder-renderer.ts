const PET_WINDOW_WIDTH = 192;
const PET_WINDOW_HEIGHT = 208;

export function drawShellPlaceholder(canvas: HTMLCanvasElement): void {
  canvas.width = PET_WINDOW_WIDTH;
  canvas.height = PET_WINDOW_HEIGHT;

  const context = canvas.getContext("2d", { alpha: true });

  if (context === null) {
    throw new Error("Canvas 2D is unavailable");
  }

  context.clearRect(0, 0, PET_WINDOW_WIDTH, PET_WINDOW_HEIGHT);
  context.imageSmoothingEnabled = true;

  context.fillStyle = "#37c6d0";
  context.beginPath();
  context.moveTo(45, 72);
  context.lineTo(62, 30);
  context.lineTo(84, 72);
  context.closePath();
  context.fill();

  context.beginPath();
  context.moveTo(108, 72);
  context.lineTo(130, 30);
  context.lineTo(147, 72);
  context.closePath();
  context.fill();

  context.beginPath();
  context.ellipse(96, 135, 57, 62, 0, 0, Math.PI * 2);
  context.fill();

  context.beginPath();
  context.ellipse(96, 87, 54, 49, 0, 0, Math.PI * 2);
  context.fill();

  context.fillStyle = "#d8fbff";
  context.beginPath();
  context.ellipse(96, 137, 31, 38, 0, 0, Math.PI * 2);
  context.fill();

  context.fillStyle = "#153442";
  context.beginPath();
  context.arc(76, 82, 5, 0, Math.PI * 2);
  context.arc(116, 82, 5, 0, Math.PI * 2);
  context.fill();

  context.strokeStyle = "#153442";
  context.lineWidth = 4;
  context.lineCap = "round";
  context.beginPath();
  context.moveTo(86, 100);
  context.quadraticCurveTo(96, 109, 106, 100);
  context.stroke();
}

