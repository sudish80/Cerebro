import type { OHLCVBar } from "../types";

export async function loadCSV(filePath: string): Promise<OHLCVBar[]> {
  const text = await Bun.file(filePath).text();
  const lines = text.split(/\r?\n/);
  const bars: OHLCVBar[] = [];

  const startIdx = lines[0]?.trim().toLowerCase().startsWith("date") ? 1 : 0;

  for (let i = startIdx; i < lines.length; i++) {
    const line = lines[i]!.trim();
    if (line === "") continue;

    const cols = line.split(",");
    if (cols.length < 6) continue;

    bars.push({
      timestamp: new Date(cols[0]!).getTime(),
      open: parseFloat(cols[1]!),
      high: parseFloat(cols[2]!),
      low: parseFloat(cols[3]!),
      close: parseFloat(cols[4]!),
      volume: parseFloat(cols[5]!),
    });
  }

  bars.sort((a, b) => a.timestamp - b.timestamp);

  console.log(`[CSV] Loaded ${bars.length} bars from ${filePath}`);
  return bars;
}
