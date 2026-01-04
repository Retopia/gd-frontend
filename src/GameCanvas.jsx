import React, { useEffect, useRef } from 'react';

export default function GameCanvas({
  currentTime,
  notes,
  targetX,
  laneY,
  scrollS,
  width = 980,
  height = 520,
  inputEvents = [],
  expectedEvents = [],
}) {
  const canvasRef = useRef(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#000000';
    ctx.fillRect(0, 0, width, height);

    // Draw lane line
    ctx.strokeStyle = '#787888';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, laneY);
    ctx.lineTo(width, laneY);
    ctx.stroke();

    // Draw target box
    ctx.strokeStyle = '#f0f0f0';
    ctx.lineWidth = 2;
    ctx.fillStyle = 'transparent';
    const boxSize = 52;
    ctx.strokeRect(targetX - boxSize / 2, laneY - boxSize / 2, boxSize, boxSize);

    // Draw target center line
    ctx.strokeStyle = '#f0f0f0';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(targetX, laneY - 90);
    ctx.lineTo(targetX, laneY + 90);
    ctx.stroke();

    // Draw notes
    const margin = 20;
    const viewLeft = currentTime;
    const viewRight = currentTime + scrollS + 0.1;

    notes.forEach((note) => {
      if (note.end_t < viewLeft - 0.2 || note.start_t > viewRight + 0.2) {
        return;
      }

      const x0 = targetX + ((note.start_t - currentTime) / scrollS) * (width - targetX - margin);
      const noteSize = 32;

      if (note.is_hold) {
        const x1 = targetX + ((note.end_t - currentTime) / scrollS) * (width - targetX - margin);
        const barThick = Math.max(6, noteSize / 5);

        // Draw hold bar
        ctx.strokeStyle = '#6edc a0';
        ctx.lineWidth = barThick;
        ctx.beginPath();
        ctx.moveTo(x0 + noteSize / 2, laneY);
        ctx.lineTo(x1 - noteSize / 2, laneY);
        ctx.stroke();

        // Draw head (blue)
        ctx.fillStyle = '#5ab4ff';
        ctx.fillRect(x0 - noteSize / 2, laneY - noteSize / 2, noteSize, noteSize);

        // Draw tail (orange triangle)
        ctx.fillStyle = '#ffaa50';
        ctx.beginPath();
        ctx.moveTo(x1, laneY);
        ctx.lineTo(x1 - noteSize / 2, laneY - noteSize / 2);
        ctx.lineTo(x1 - noteSize / 2, laneY + noteSize / 2);
        ctx.closePath();
        ctx.fill();
      } else {
        // Draw single note (blue)
        ctx.fillStyle = '#5ab4ff';
        ctx.fillRect(x0 - noteSize / 2, laneY - noteSize / 2, noteSize, noteSize);
      }
    });

  }, [currentTime, notes, targetX, laneY, scrollS, width, height]);

  return (
    <canvas
      ref={canvasRef}
      width={width}
      height={height}
      className="w-full h-full bg-black"
    />
  );
}
