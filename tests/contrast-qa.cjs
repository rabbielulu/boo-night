const { chromium } = require("playwright");

(async () => {
  const executablePath = process.env.BROWSER_PATH;
  const browser = await chromium.launch({
    headless: true,
    ...(executablePath ? { executablePath } : {}),
  });
  const page = await browser.newPage({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 2,
    isMobile: true,
    hasTouch: true,
  });
  await page.goto(process.env.TEST_URL ?? "http://127.0.0.1:4173", { waitUntil: "networkidle" });
  await page.waitForTimeout(1800);

  const metrics = await page.locator("#world").evaluate((canvas) => {
    const context = canvas.getContext("2d");
    const data = context.getImageData(0, 0, canvas.width, canvas.height).data;
    let minLuminance = 255;
    let maxLuminance = 0;
    let luminanceTotal = 0;
    let sampleCount = 0;
    let nearBlack = 0;
    let nearWhite = 0;
    let softOutline = 0;

    for (let offset = 0; offset < data.length; offset += 16) {
      const red = data[offset];
      const green = data[offset + 1];
      const blue = data[offset + 2];
      const luminance = 0.2126 * red + 0.7152 * green + 0.0722 * blue;
      minLuminance = Math.min(minLuminance, luminance);
      maxLuminance = Math.max(maxLuminance, luminance);
      luminanceTotal += luminance;
      sampleCount += 1;
      if (luminance < 25) nearBlack += 1;
      if (red > 248 && green > 248 && blue > 248) nearWhite += 1;
      if (red >= 42 && red <= 72 && green >= 52 && green <= 86 && blue >= 72 && blue <= 116) {
        softOutline += 1;
      }
    }

    return {
      width: canvas.width,
      height: canvas.height,
      minLuminance: Number(minLuminance.toFixed(1)),
      maxLuminance: Number(maxLuminance.toFixed(1)),
      averageLuminance: Number((luminanceTotal / sampleCount).toFixed(1)),
      nearBlackRate: Number((nearBlack / sampleCount).toFixed(5)),
      nearWhiteRate: Number((nearWhite / sampleCount).toFixed(5)),
      softOutlineSamples: softOutline,
    };
  });

  if (metrics.averageLuminance < 70) throw new Error(`Background remains too dark: ${JSON.stringify(metrics)}`);
  if (metrics.nearBlackRate > 0.01) throw new Error(`Too many near-black pixels: ${JSON.stringify(metrics)}`);
  if (metrics.nearWhiteRate > 0.002) throw new Error(`Too many near-white pixels: ${JSON.stringify(metrics)}`);
  if (metrics.softOutlineSamples < 100) throw new Error(`Soft blue-gray outlines were not detected: ${JSON.stringify(metrics)}`);

  await page.screenshot({ path: "tests/mobile-qa.png", fullPage: true });
  console.log(JSON.stringify({ ...metrics, status: "PASS" }, null, 2));
  await browser.close();
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});