/**
 * Which region to put the media server in — measured, not assumed.
 *
 *   pnpm measure:regions
 *   pnpm measure:regions --samples 20
 *   pnpm measure:regions --url wss://your-project.livekit.cloud
 *
 * **Run it from the market, not from a data centre.** The number that matters
 * is the round trip from a student in Karachi or a tutor in Dubai on their own
 * connection — from a cloud VM in Europe every region looks close, and the
 * ranking it produces is about the VM rather than about anybody's lesson.
 *
 * Without `--url` it measures the TCP and TLS handshake to a public endpoint
 * inside each candidate cloud region. That is a proxy for LiveKit Cloud's own
 * edge in the same region, not the edge itself: good enough to rank regions,
 * not precise enough to quote. With `--url` it measures the real thing.
 *
 * Latency, not bandwidth, is what decides this. A lesson is two people talking;
 * every 100ms of round trip is 100ms of both of them waiting to find out
 * whether the other has finished a sentence.
 */

import { connect } from 'node:tls';
import { connect as tcpConnect } from 'node:net';

type Candidate = { region: string; where: string; host: string; port: number };

/**
 * The regions worth considering for a Pakistan- and Gulf-first market. Dubai
 * first, as the closest landing point to Karachi; Mumbai is nearer on a map but
 * the routing between Pakistan and India is not always what a map suggests.
 */
const CANDIDATES: Candidate[] = [
  { region: 'me-central-1', where: 'Dubai, UAE', host: 'ec2.me-central-1.amazonaws.com', port: 443 },
  { region: 'me-south-1', where: 'Bahrain', host: 'ec2.me-south-1.amazonaws.com', port: 443 },
  { region: 'ap-south-1', where: 'Mumbai, India', host: 'ec2.ap-south-1.amazonaws.com', port: 443 },
  { region: 'eu-central-1', where: 'Frankfurt, Germany', host: 'ec2.eu-central-1.amazonaws.com', port: 443 },
  { region: 'ap-southeast-1', where: 'Singapore', host: 'ec2.ap-southeast-1.amazonaws.com', port: 443 },
];

const TIMEOUT_MS = 5_000;

/** One TCP handshake, in milliseconds. Null when it did not complete. */
function timeTcp(host: string, port: number): Promise<number | null> {
  return new Promise((resolve) => {
    const started = performance.now();
    const socket = tcpConnect({ host, port, timeout: TIMEOUT_MS });

    const done = (value: number | null) => {
      socket.removeAllListeners();
      socket.destroy();
      resolve(value);
    };

    socket.once('connect', () => done(Math.round(performance.now() - started)));
    socket.once('timeout', () => done(null));
    socket.once('error', () => done(null));
  });
}

/** One TLS handshake, which is closer to what a WebSocket join costs. */
function timeTls(host: string, port: number): Promise<number | null> {
  return new Promise((resolve) => {
    const started = performance.now();
    const socket = connect({ host, port, servername: host, timeout: TIMEOUT_MS });

    const done = (value: number | null) => {
      socket.removeAllListeners();
      socket.destroy();
      resolve(value);
    };

    socket.once('secureConnect', () => done(Math.round(performance.now() - started)));
    socket.once('timeout', () => done(null));
    socket.once('error', () => done(null));
  });
}

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1
    ? sorted[middle]!
    : Math.round((sorted[middle - 1]! + sorted[middle]!) / 2);
}

async function main() {
  const args = process.argv.slice(2);
  const sampleIndex = args.indexOf('--samples');
  const samples = sampleIndex === -1 ? 10 : Math.max(3, Math.min(Number(args[sampleIndex + 1]), 50));

  const urlIndex = args.indexOf('--url');
  const candidates: Candidate[] =
    urlIndex === -1
      ? CANDIDATES
      : [
          {
            region: 'configured',
            where: args[urlIndex + 1]!,
            host: new URL(args[urlIndex + 1]!.replace(/^ws/, 'http')).hostname,
            port: 443,
          },
        ];

  console.log(`Measuring ${candidates.length} regions, ${samples} samples each.\n`);
  console.log('Run this from the network your students are on. From a data centre');
  console.log('everything looks close, and the ranking is about the data centre.\n');

  const results: { region: string; where: string; tcp: number | null; tls: number | null; lost: number }[] =
    [];

  for (const candidate of candidates) {
    const tcp: number[] = [];
    const tls: number[] = [];
    let lost = 0;

    for (let sample = 0; sample < samples; sample += 1) {
      const t = await timeTcp(candidate.host, candidate.port);
      if (t === null) lost += 1;
      else tcp.push(t);

      const s = await timeTls(candidate.host, candidate.port);
      if (s !== null) tls.push(s);
    }

    results.push({
      region: candidate.region,
      where: candidate.where,
      tcp: median(tcp),
      tls: median(tls),
      lost,
    });
  }

  results.sort((a, b) => (a.tcp ?? Infinity) - (b.tcp ?? Infinity));

  console.log('region           where                 tcp    tls   failed');
  console.log('-------------------------------------------------------------');
  for (const result of results) {
    console.log(
      `${result.region.padEnd(16)} ${result.where.padEnd(20)} ` +
        `${(result.tcp === null ? '—' : `${result.tcp}ms`).padStart(6)} ` +
        `${(result.tls === null ? '—' : `${result.tls}ms`).padStart(6)}   ` +
        `${result.lost}/${samples}`,
    );
  }

  const best = results.find((result) => result.tcp !== null);
  if (best) {
    console.log(`\nClosest from here: ${best.region} (${best.where}).`);
  }
  console.log('\nA one-way trip is roughly half the TCP figure. Under ~150ms round');
  console.log('trip a conversation feels normal; past ~300ms people start talking over');
  console.log('each other, which is what the classroom is built to survive.');

  process.exit(0);
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
