window.drawPageInk = function (canvas, strokes, bounds = [0, 0, 1, 1], mask = null) {
  const [left, top, right, bottom] = bounds;
  const scale = Math.min(1, 720 / (794 * (right - left)));
  canvas.width = Math.max(1, Math.round(794 * (right - left) * scale));
  canvas.height = Math.max(1, Math.round(1123 * (bottom - top) * scale));
  const ctx = canvas.getContext("2d");
  const x = value => (value - left) * canvas.width / (right - left);
  const y = value => (value - top) * canvas.height / (bottom - top);
  for (const stroke of strokes) {
    if (!Array.isArray(stroke?.points) || !stroke.points.length) continue;
    ctx.lineCap = ctx.lineJoin = "round";
    ctx.lineWidth = (Number(stroke.width) || 2) * scale;
    ctx.strokeStyle = stroke.color || "#343a40";
    ctx.globalAlpha = stroke.opacity ?? (stroke.tool === "highlighter" ? .32 : stroke.tool === "pencil" ? .72 : 1);
    ctx.globalCompositeOperation = stroke.tool === "eraser" ? "destination-out" : "source-over";
    ctx.beginPath();
    stroke.points.forEach((point, index) => {
      if (index === 0) ctx.moveTo(x(point[0]), y(point[1]));
      else ctx.lineTo(x(point[0]), y(point[1]));
    });
    if (stroke.points.length === 1) ctx.lineTo(x(stroke.points[0][0]) + .1, y(stroke.points[0][1]) + .1);
    ctx.stroke();
  }
  if (mask) {
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = "source-over";
    ctx.fillStyle = "#526858";
    ctx.fillRect(x(mask[0]), y(mask[1]), x(mask[2]) - x(mask[0]), y(mask[3]) - y(mask[1]));
  }
};
