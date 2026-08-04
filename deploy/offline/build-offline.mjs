#!/usr/bin/env node
// 离线客户端包构建脚本（Linux/macOS 一键版；Windows 请双击 deploy/offline/打包客户端.bat）
// 用法：node deploy/offline/build-offline.mjs <服务器地址> [输出目录]
//   服务器地址示例：ws://47.97.87.169/ws 或 wss://skb.example.com/ws
// 内部流程：注入 VITE_WS_URL 构建 client/dist → 调用 assemble-offline.mjs 组装
import {execFileSync} from "node:child_process";
import {resolve,dirname} from "node:path";
import {fileURLToPath} from "node:url";

const here=dirname(fileURLToPath(import.meta.url));
const root=resolve(here,"../..");
const wsArg=process.argv[2];
const outArg=process.argv[3];
if(!wsArg){console.error("用法: node deploy/offline/build-offline.mjs <ws服务器地址> [输出目录]");process.exit(1);}
try{const u=new URL(wsArg);if(u.protocol!=="ws:"&&u.protocol!=="wss:")throw new Error("protocol");}catch{console.error(`服务器地址必须形如 ws://host:port/ws 或 wss://host/ws，收到: ${wsArg}`);process.exit(1);}

console.log(`==> 构建客户端（VITE_WS_URL=${wsArg}）`);
try{
  execFileSync("npm",["run","build"],{cwd:resolve(root,"client"),env:{...process.env,VITE_WS_URL:wsArg},stdio:"inherit"});
}catch(error){console.error("客户端构建失败：",error instanceof Error?error.message:String(error));process.exit(1);}

const assemble=[resolve(here,"assemble-offline.mjs")];
if(outArg)assemble.push(outArg);
execFileSync(process.execPath,assemble,{cwd:root,stdio:"inherit"});
