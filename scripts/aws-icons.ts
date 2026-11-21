#!/usr/bin/env bun
// Builds an icon pack from the official AWS Architecture Icons package.
//
//   1. Download the "Icon package" zip from https://aws.amazon.com/architecture/icons/
//   2. bun scripts/aws-icons.ts ~/Downloads/Icon-package_XXXX.zip
//
// It writes icons/aws.json, which is git-ignored. AWS lets customers and
// partners use these icons to make architecture diagrams; it does not hand out
// the right to pass the artwork on, so the pack stays on your machine and only
// the icons a deck uses travel inside that deck.
//
// Names: "aws:lambda", "aws:simple-storage-service" (also "aws:s3"),
// resource icons such as "aws:simple-storage-service-bucket".

import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { $ } from 'bun';

const args = process.argv.slice(2);
const oi = args.indexOf('-o');
const out = oi >= 0 ? args.splice(oi, 2)[1] : join(import.meta.dir, '..', 'icons', 'aws.json');
const source = args[0];
if (!source) { console.error('Usage: bun scripts/aws-icons.ts <Icon-package.zip or unzipped folder> [-o icons/aws.json]'); process.exit(1); }

let root = source, temp = '';
if (statSync(source).isFile()) {
  temp = mkdtempSync(join(tmpdir(), 'aws-icons-'));
  await $`unzip -q -o ${source} -d ${temp}`.quiet();
  root = temp;
}

const walk = (dir: string): string[] => readdirSync(dir, { withFileTypes: true }).flatMap((d) =>
  d.name.startsWith('.') || d.name === '__MACOSX' ? [] : d.isDirectory() ? walk(join(dir, d.name)) : [join(dir, d.name)]);
const slug = (s: string) => s.replace(/^(AWS|Amazon)-/, '').replace(/_/g, '-').replace(/[^A-Za-z0-9-]+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '').toLowerCase();
const clean = (svg: string) => svg.replace(/<\?xml[^>]*\?>/, '').replace(/<!--[\s\S]*?-->/g, '').replace(/<title>[\s\S]*?<\/title>/, '').replace(/<script[\s\S]*?<\/script>/gi, '').replace(/>\s+</g, '><').trim();

// Short names people actually say.
const alias: Record<string, string> = {
  s3: 'simple-storage-service', sqs: 'simple-queue-service', sns: 'simple-notification-service', ses: 'simple-email-service',
  ecs: 'elastic-container-service', eks: 'elastic-kubernetes-service', ecr: 'elastic-container-registry', ec2: 'ec2',
  elb: 'elastic-load-balancing', alb: 'elastic-load-balancing-application-load-balancer', nlb: 'elastic-load-balancing-network-load-balancer',
  vpc: 'virtual-private-cloud', iam: 'identity-and-access-management', kms: 'key-management-service', opensearch: 'opensearch-service',
  efs: 'efs', ebs: 'elastic-block-store', msk: 'managed-streaming-for-apache-kafka', kinesis: 'kinesis', 'api-gateway': 'api-gateway',
  eventbridge: 'eventbridge', 'step-functions': 'step-functions', bedrock: 'bedrock', sagemaker: 'sagemaker-ai', redshift: 'redshift',
};

const pack: Record<string, string> = {};
const add = (name: string, file: string) => { if (!pack[name]) pack[name] = clean(readFileSync(file, 'utf8')); };
const files = walk(root).filter((p) => p.endsWith('.svg'));
let service = 0, resource = 0, group = 0;
// Service icons first so they win a name clash with a resource icon.
for (const p of files) {
  const m = p.match(/\/Arch_([^/]+)_48\.svg$/);
  if (m && !/Arch-Category/.test(p)) { add('aws:' + slug(m[1]), p); service++; }
}
for (const p of files) {
  const m = p.match(/\/Res_([^/]+)_48\.svg$/);
  if (m) { add('aws:' + slug(m[1]), p); resource++; }
}
for (const p of files) {
  const m = p.match(/Architecture-Group-Icons[^/]*\/([^/]+)_32\.svg$/);
  if (m) { add('aws:group-' + slug(m[1]), p); group++; }
}
for (const [short, full] of Object.entries(alias)) if (pack['aws:' + full] && !pack['aws:' + short]) pack['aws:' + short] = pack['aws:' + full];

if (temp) rmSync(temp, { recursive: true });
if (!Object.keys(pack).length) { console.error('No AWS icons found in ' + source + '. Is it the "Icon package" download?'); process.exit(1); }
mkdirSync(join(out, '..'), { recursive: true });
await Bun.write(out, JSON.stringify(pack));
console.log(`wrote ${out}: ${Object.keys(pack).length} icons (${service} service, ${resource} resource, ${group} group files read)`);
console.log('Use them as "icon": "aws:lambda". List names with: bun -e \'console.log(Object.keys(require("./icons/aws.json")).join("\\n"))\' | grep s3');
