#!/usr/bin/env node
// 离线客户端包组装脚本（纯文件操作，无子进程依赖）
// 前提：client/dist 已用 VITE_WS_URL=<服务器地址> 构建完成
// 用法：node deploy/offline/assemble-offline.mjs [输出目录]   （输出默认 deploy/offline/out/skb-client-offline）
import {cp,mkdir,rm,writeFile} from "node:fs/promises";
import {resolve,dirname} from "node:path";
import {fileURLToPath} from "node:url";

const here=dirname(fileURLToPath(import.meta.url));
const root=resolve(here,"../..");
const outArg=process.argv[2]??resolve(here,"out","skb-client-offline");

console.log(`==> 组装离线包 -> ${outArg}`);
await rm(outArg,{recursive:true,force:true});
await mkdir(outArg,{recursive:true});
await cp(resolve(root,"client","dist"),outArg,{recursive:true});
await cp(resolve(here,"start-local.mjs"),resolve(outArg,"start-local.mjs"));
await cp(resolve(here,"README.txt"),resolve(outArg,"使用说明.txt"));
await writeFile(resolve(outArg,"启动客户端.bat"),"@echo off\r\ncd /d %~dp0\r\necho 正在启动本地客户端服务（端口 8080），完成后请在浏览器打开 http://localhost:8080\r\nnode start-local.mjs\r\npause\r\n","utf8");
await writeFile(resolve(outArg,"启动客户端.command"),"#!/bin/bash\ncd \"$(dirname \"$0\")\"\necho '启动中，浏览器打开 http://localhost:8080'\nnode start-local.mjs\n","utf8");
console.log("==> 组装完成。压缩本目录发给客户：解压 → 双击「启动客户端.bat」→ 浏览器访问 http://localhost:8080");
