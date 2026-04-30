import type { SttSlice, TtsSlice } from "../audio/store";
import { noBase64Snippets } from "./chat";
import type { CodeSnippets } from "./chat";

const KEY = "<YOUR_API_KEY>";
const TTS_PATH = "/v1/audio/speech";
const STT_PATH = "/v1/audio/transcriptions";

export interface GenAudioSnippetsInput {
  activeTab: "tts" | "stt";
  apiBaseUrl: string;
  tts: TtsSlice;
  stt: SttSlice;
}

export function genAudioSnippets({ activeTab, apiBaseUrl, tts, stt }: GenAudioSnippetsInput): CodeSnippets {
  return activeTab === "tts" ? genTts(apiBaseUrl, tts) : genStt(apiBaseUrl, stt);
}

function genTts(apiBaseUrl: string, tts: TtsSlice): CodeSnippets {
  const url = `${apiBaseUrl}${TTS_PATH}`;
  const body = {
    model: "<YOUR_MODEL>",
    input: tts.input || "Hello world.",
    voice: tts.voice,
    response_format: tts.format,
    ...(tts.speed !== undefined ? { speed: tts.speed } : {}),
  };
  const curl = [
    `curl -X POST ${url} \\`,
    `  -H "Authorization: Bearer ${KEY}" \\`,
    `  -H "Content-Type: application/json" \\`,
    `  --output speech.${tts.format} \\`,
    `  -d '${JSON.stringify(body)}'`,
  ].join("\n");

  const pythonOpts: string[] = [
    `    model="<YOUR_MODEL>"`,
    `    voice="${tts.voice}"`,
    `    input=${JSON.stringify(tts.input || "Hello world.")}`,
    `    response_format="${tts.format}"`,
  ];
  if (tts.speed !== undefined) pythonOpts.push(`    speed=${tts.speed}`);
  const python = [
    "from openai import OpenAI",
    `client = OpenAI(base_url="${apiBaseUrl}", api_key="${KEY}")`,
    "with client.audio.speech.with_streaming_response.create(",
    pythonOpts.join(",\n") + ",",
    `) as resp:`,
    `    resp.stream_to_file("speech.${tts.format}")`,
  ].join("\n");

  const nodeOpts: string[] = [
    `  model: "<YOUR_MODEL>"`,
    `  voice: "${tts.voice}"`,
    `  input: ${JSON.stringify(tts.input || "Hello world.")}`,
    `  response_format: "${tts.format}"`,
  ];
  if (tts.speed !== undefined) nodeOpts.push(`  speed: ${tts.speed}`);
  const node = [
    `import OpenAI from "openai";`,
    `import { writeFileSync } from "fs";`,
    `const client = new OpenAI({ baseURL: "${apiBaseUrl}", apiKey: "${KEY}" });`,
    `const resp = await client.audio.speech.create({`,
    nodeOpts.join(",\n") + ",",
    `});`,
    `writeFileSync("speech.${tts.format}", Buffer.from(await resp.arrayBuffer()));`,
  ].join("\n");

  return noBase64Snippets(curl, python, node);
}

function genStt(apiBaseUrl: string, stt: SttSlice): CodeSnippets {
  const url = `${apiBaseUrl}${STT_PATH}`;
  const fileName = stt.fileName || "audio.wav";
  const curlParts = [
    `curl -X POST ${url} \\`,
    `  -H "Authorization: Bearer ${KEY}" \\`,
    `  -F "file=@${fileName}" \\`,
    `  -F "model=<YOUR_MODEL>"`,
  ];
  if (stt.language) curlParts.push(`  -F "language=${stt.language}"`);
  if (stt.task) curlParts.push(`  -F "task=${stt.task}"`);
  if (stt.prompt) curlParts.push(`  -F "prompt=${JSON.stringify(stt.prompt).slice(1, -1)}"`);
  if (stt.temperature !== undefined) curlParts.push(`  -F "temperature=${stt.temperature}"`);
  const curl = curlParts.join(" \\\n");

  const pythonOpts: string[] = [
    `    model="<YOUR_MODEL>"`,
    `    file=open("${fileName}", "rb")`,
  ];
  if (stt.language) pythonOpts.push(`    language="${stt.language}"`);
  if (stt.task && stt.task !== "transcribe") pythonOpts.push(`    # task="${stt.task}" -> use audio.translations.create instead`);
  if (stt.prompt) pythonOpts.push(`    prompt=${JSON.stringify(stt.prompt)}`);
  if (stt.temperature !== undefined) pythonOpts.push(`    temperature=${stt.temperature}`);
  const python = [
    "from openai import OpenAI",
    `client = OpenAI(base_url="${apiBaseUrl}", api_key="${KEY}")`,
    `resp = client.audio.transcriptions.create(`,
    pythonOpts.join(",\n") + ",",
    `)`,
    `print(resp.text)`,
  ].join("\n");

  const nodeOpts: string[] = [
    `  model: "<YOUR_MODEL>"`,
    `  file: createReadStream("${fileName}")`,
  ];
  if (stt.language) nodeOpts.push(`  language: "${stt.language}"`);
  if (stt.prompt) nodeOpts.push(`  prompt: ${JSON.stringify(stt.prompt)}`);
  if (stt.temperature !== undefined) nodeOpts.push(`  temperature: ${stt.temperature}`);
  const node = [
    `import OpenAI from "openai";`,
    `import { createReadStream } from "fs";`,
    `const client = new OpenAI({ baseURL: "${apiBaseUrl}", apiKey: "${KEY}" });`,
    `const resp = await client.audio.transcriptions.create({`,
    nodeOpts.join(",\n") + ",",
    `});`,
    `console.log(resp.text);`,
  ].join("\n");

  return noBase64Snippets(curl, python, node);
}
