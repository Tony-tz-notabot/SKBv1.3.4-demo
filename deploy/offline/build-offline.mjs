#!/usr/bin/env node
// 离线客户端包构建脚本：注入云服务器地址 → 构建客户端 → 打包 dist + 本地启动器
// 用法：node deploy/offline/build-offline.mjs <服务器地址> [输出目录]
//   服务器地址示例：ws://47.100.10.20:8787/ws  或  wss://skb.example.com/ws
//   输出默认：deploy/offline/out/skb-client-offline/
import {execSync} from "node:child_process";
import {cp, mkdir, rm, writeFile} from "node:fs/promises";
import {existsSync} from "node:fs";
import {resolve,dirname} from "node:path";
import {fileURLToPath} from "node:url";

const here=dirname(fileURLToPath(import.meta.url));
const root=resolve(here,"../../..");
const wsArg=process.argv[2];
const outArg=process.argv[3]??resolve(here,"out","skb-client-offline");
if(!wsArg){console.error("用法: node deploy/offline/build-offline.mjs <ws服务器地址> [输出目录]");process.exit(1);}
// 校验 ws 地址
try{const u=new URL(wsArg);if(u.protocol!=="ws:"&&u.protocol!=="wss:")throw new Error("protocol");}catch{console.error(`服务器地址必须形如 ws://host:port/ws 或 wss://host/ws，收到: ${wsArg}`);process.exit(1);}

console.log(`==> 构建客户端（VITE_WS_URL=${wsArg}）`);
execSync(`npm run build`,{cwd:resolve(root,"client"),env:{...process.env,VITE_WS_URL:wsArg},stdio:"inherit"});

console.log(`==> 组装离线包 -> ${outArg}`);
await rm(outArg,{recursive:true,force:true});
await mkdir(outArg,{recursive:true});
await cp(resolve(root,"client","dist"),outArg,{recursive:true});
await cp(resolve(here,"start-local.mjs"),resolve(outArg,"start-local.mjs"));
await cp(resolve(here,"README.txt"),resolve(outArg,"使用说明.txt"));
await writeFile(resolve(outArg,"启动客户端.bat"),"@echo off\r\ncd /d %~dp0\r\necho 正在启动本地客户端服务（端口 8080），完成后请在浏览器打开 http://localhost:8080\r\nnode start-local.mjs\r\npause\r\n");
await writeFile(resolve(outArg,"启动客户端.command"),"#!/bin/bash\ncd \"$(dirname \"$0\")\"\necho '启动中，浏览器打开 http://localhost:8080'\nnode start-local.mjs\n");
console.log("==> 完成。将整个目录发给客户：解压 → 双击「启动客户端.bat」→ 浏览器访问 http://localhost:8080");
