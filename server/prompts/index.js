import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const dir = path.dirname(fileURLToPath(import.meta.url));
const promptPath = path.join(dir, 'client-system-prompt.txt');

export const CLIENT_SYSTEM_PROMPT = fs.readFileSync(promptPath, 'utf8').trim();

export function buildSystemPrompt(stageInstructions) {
  return `${CLIENT_SYSTEM_PROMPT}\n\n---\n\n${String(stageInstructions || '').trim()}`;
}
