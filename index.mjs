import {
  CloudWatchClient,
  GetMetricStatisticsCommand,
} from "@aws-sdk/client-cloudwatch";
import {
  EC2Client,
  DescribeInstancesCommand,
} from "@aws-sdk/client-ec2";
import {
  CostExplorerClient,
  GetCostAndUsageCommand,
} from "@aws-sdk/client-cost-explorer";

// ── CONFIG ────────────────────────────────────────────────────────────────────
// Configure via Lambda Environment Variables (see README):
//   INSTANCE_ID   – your EC2 instance id, e.g. i-0abc123def456789
//   DATA_CAP_GB   – your monthly data cap in GB (default: 1000)
const INSTANCE_ID = process.env.INSTANCE_ID || "i-CHANGE-ME";
const DATA_CAP_GB = parseFloat(process.env.DATA_CAP_GB || "1000");
const REGION = process.env.AWS_REGION || "us-east-1";

// ── AWS CLIENTS ───────────────────────────────────────────────────────────────
const cw  = new CloudWatchClient({ region: REGION });
const ec2 = new EC2Client({ region: REGION });
const ce  = new CostExplorerClient({ region: "us-east-1" }); // Cost Explorer is always us-east-1

// ── HELPERS ───────────────────────────────────────────────────────────────────
function monthBounds() {
  const now   = new Date();
  const start = new Date(now.getFullYear(), now.getMonth(), 1);
  return { start, end: now };
}

async function getNetworkBytes(metricName, instanceId, start, end) {
  const resp = await cw.send(
    new GetMetricStatisticsCommand({
      Namespace:  "AWS/EC2",
      MetricName: metricName,
      Dimensions: [{ Name: "InstanceId", Value: instanceId }],
      StartTime:  start,
      EndTime:    end,
      Period:     Math.ceil((end - start) / 1000 / 60) * 60, // must be multiple of 60
      Statistics: ["Sum"],
    })
  );
  const dp = resp.Datapoints?.[0];
  return dp ? dp.Sum : 0; // bytes
}

async function getInstanceName(instanceId) {
  try {
    const resp = await ec2.send(
      new DescribeInstancesCommand({ InstanceIds: [instanceId] })
    );
    const inst = resp.Reservations?.[0]?.Instances?.[0];
    const tag  = inst?.Tags?.find((t) => t.Key === "Name");
    return tag?.Value || instanceId;
  } catch {
    return instanceId;
  }
}

async function getMonthlyCost(start, end) {
  try {
    const fmt  = (d) => d.toISOString().slice(0, 10);
    const resp = await ce.send(
      new GetCostAndUsageCommand({
        TimePeriod:  { Start: fmt(start), End: fmt(end) },
        Granularity: "MONTHLY",
        Metrics:     ["UnblendedCost"],
      })
    );
    const amount = resp.ResultsByTime?.[0]?.Total?.UnblendedCost?.Amount || "0";
    const unit   = resp.ResultsByTime?.[0]?.Total?.UnblendedCost?.Unit   || "USD";
    return { amount: parseFloat(amount).toFixed(2), unit };
  } catch (e) {
    return { amount: "N/A", unit: "USD", error: e.message };
  }
}

// ── MAIN HANDLER ──────────────────────────────────────────────────────────────
export const handler = async () => {
  const { start, end } = monthBounds();

  const [inBytes, outBytes, name, cost] = await Promise.all([
    getNetworkBytes("NetworkIn",  INSTANCE_ID, start, end),
    getNetworkBytes("NetworkOut", INSTANCE_ID, start, end),
    getInstanceName(INSTANCE_ID),
    getMonthlyCost(start, end),
  ]);

  const toGB     = (b) => b / 1e9;
  const inGB     = toGB(inBytes);
  const outGB    = toGB(outBytes);
  const totalGB  = inGB + outGB;
  const remainGB = Math.max(DATA_CAP_GB - totalGB, 0);
  const pct      = Math.min((totalGB / DATA_CAP_GB) * 100, 100).toFixed(1);

  const monthName = start.toLocaleString("default", {
    month: "long",
    year:  "numeric",
  });

  // Gauge colour: green → amber → red
  const arcColor = pct < 60 ? "#00e5a0" : pct < 85 ? "#f5a623" : "#ff4d4d";

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>EC2 Data Dashboard</title>
<link href="https://fonts.googleapis.com/css2?family=Share+Tech+Mono&family=Orbitron:wght@400;700;900&display=swap" rel="stylesheet"/>
<style>
  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
  :root {
    --bg:      #060b14; --surface: #0d1727; --border: #1a2f50;
    --accent:  ${arcColor}; --dim: #4a6380; --text: #cde0ff;
    --mono: 'Share Tech Mono', monospace; --head: 'Orbitron', sans-serif;
  }
  body {
    background: var(--bg); color: var(--text); font-family: var(--mono);
    min-height: 100vh; display: flex; flex-direction: column;
    align-items: center; justify-content: center; padding: 2rem 1rem;
    background-image:
      radial-gradient(ellipse 80% 60% at 50% -10%, #0a2040 0%, transparent 70%),
      repeating-linear-gradient(0deg, transparent, transparent 39px, #0d1727 39px, #0d1727 40px),
      repeating-linear-gradient(90deg, transparent, transparent 39px, #0d1727 39px, #0d1727 40px);
  }
  header { text-align: center; margin-bottom: 2.5rem; animation: fadeDown .6s ease both; }
  header h1 { font-family: var(--head); font-size: clamp(1.1rem, 4vw, 1.6rem); font-weight: 900; letter-spacing: .2em; text-transform: uppercase; color: #fff; }
  header p  { font-size: .75rem; color: var(--dim); letter-spacing: .15em; margin-top: .4rem; }
  .gauge-wrap { position: relative; width: 220px; height: 130px; margin: 0 auto 2rem; animation: fadeUp .7s .15s ease both; }
  .gauge-wrap svg { overflow: visible; }
  .gauge-label { position: absolute; bottom: 0; left: 50%; transform: translateX(-50%); text-align: center; }
  .gauge-label .pct { font-family: var(--head); font-size: 2.4rem; font-weight: 900; color: var(--accent); line-height: 1; }
  .gauge-label .sub { font-size: .65rem; color: var(--dim); letter-spacing: .12em; }
  .cards { display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 1rem; width: 100%; max-width: 640px; animation: fadeUp .7s .3s ease both; }
  .card { background: var(--surface); border: 1px solid var(--border); border-radius: 4px; padding: 1.1rem 1rem; position: relative; overflow: hidden; }
  .card::before { content: ''; position: absolute; inset: 0 0 auto 0; height: 2px; background: var(--accent); opacity: .6; }
  .card .label { font-size: .6rem; letter-spacing: .18em; text-transform: uppercase; color: var(--dim); margin-bottom: .5rem; }
  .card .value { font-family: var(--head); font-size: 1.35rem; font-weight: 700; color: #fff; line-height: 1; }
  .card .unit  { font-size: .65rem; color: var(--dim); margin-top: .2rem; }
  .card.credits::before { background: #7b61ff; }
  .card.credits .value  { color: #b8a9ff; }
  .bar-wrap { width: 100%; max-width: 640px; margin: 1.2rem auto 0; animation: fadeUp .7s .45s ease both; }
  .bar-track { height: 6px; background: var(--border); border-radius: 3px; overflow: hidden; }
  .bar-fill  { height: 100%; width: ${pct}%; background: var(--accent); border-radius: 3px; transition: width 1s ease; box-shadow: 0 0 10px var(--accent); }
  .bar-labels { display: flex; justify-content: space-between; font-size: .6rem; color: var(--dim); margin-top: .4rem; letter-spacing: .1em; }
  footer { margin-top: 2.5rem; font-size: .6rem; color: var(--dim); letter-spacing: .12em; text-align: center; animation: fadeUp .7s .55s ease both; }
  footer span { color: var(--text); }
  @keyframes fadeDown { from { opacity:0; transform:translateY(-16px) } to { opacity:1; transform:none } }
  @keyframes fadeUp   { from { opacity:0; transform:translateY(16px)  } to { opacity:1; transform:none } }
</style>
</head>
<body>

<header>
  <h1>EC2 Data Monitor</h1>
  <p>${name} &nbsp;·&nbsp; ${monthName}</p>
</header>

<div class="gauge-wrap">
  <svg viewBox="0 0 220 120" width="220" height="120">
    <path d="M20,110 A90,90 0 0,1 200,110" fill="none" stroke="#1a2f50" stroke-width="14" stroke-linecap="round"/>
    <path d="M20,110 A90,90 0 0,1 200,110" fill="none" stroke="${arcColor}" stroke-width="14" stroke-linecap="round"
          stroke-dasharray="282.7" stroke-dashoffset="${(282.7 * (1 - pct / 100)).toFixed(1)}"
          style="filter:drop-shadow(0 0 6px ${arcColor})"/>
  </svg>
  <div class="gauge-label">
    <div class="pct">${pct}%</div>
    <div class="sub">USED</div>
  </div>
</div>

<div class="cards">
  <div class="card">
    <div class="label">Total Used</div>
    <div class="value">${totalGB.toFixed(2)}</div>
    <div class="unit">GB this month</div>
  </div>
  <div class="card">
    <div class="label">Remaining</div>
    <div class="value">${remainGB.toFixed(2)}</div>
    <div class="unit">GB of ${DATA_CAP_GB} GB cap</div>
  </div>
  <div class="card">
    <div class="label">↓ Download</div>
    <div class="value">${inGB.toFixed(2)}</div>
    <div class="unit">GB in</div>
  </div>
  <div class="card">
    <div class="label">↑ Upload</div>
    <div class="value">${outGB.toFixed(2)}</div>
    <div class="unit">GB out</div>
  </div>
  <div class="card credits">
    <div class="label">AWS Cost This Month</div>
    <div class="value">${cost.amount}</div>
    <div class="unit">${cost.unit}${cost.error ? " (unavailable)" : ""}</div>
  </div>
</div>

<div class="bar-wrap">
  <div class="bar-track"><div class="bar-fill"></div></div>
  <div class="bar-labels"><span>0 GB</span><span>${DATA_CAP_GB} GB</span></div>
</div>

<footer>
  Last updated &nbsp;<span>${new Date().toUTCString()}</span><br/>
  Refresh the page for live data
</footer>

</body>
</html>`;

  return {
    statusCode: 200,
    headers: { "Content-Type": "text/html; charset=utf-8" },
    body: html,
  };
};
