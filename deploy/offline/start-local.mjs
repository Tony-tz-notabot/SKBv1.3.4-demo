#!/usr/bin/env node
// 离线客户端本地启动器：在 8080 端口托管当前目录（client/dist），纯本地、不发任何游戏流量
// 游戏数据/WebSocket 全部走构建时注入的云服务器地址
import {createServer} from "node:http";
import {readFile,stat} from "node:fs/promises";
import {extname,resolve} from "node:path";

const root=resolve(import.meta.dirname??".");
const port=Number(process.env.PORT??8080);
const mime={".html":"text/html; charset=utf-8",".js":"text/javascript; charset=utf-8",".css":"text/css; charset=utf-8",".png":"image/png",".jpg":"image/jpeg",".svg":"image/svg+xml",".json":"application/json",".ico":"image/x-icon",".webp":"image/webp",".woff2":"font/woff2"};
const server=createServer(async(req,res)=>{
  try{
    if(req.method!=="GET"&&req.method!=="HEAD"){res.writeHead(404);res.end("Not found");return}
    const pathname=decodeURIComponent(new URL(req.url??"/","http://localhost").pathname);
    let file=resolve(root,pathname==="/"?"index.html":pathname.replace(/^\/+/,""));
    if(!file.startsWith(root)){res.writeHead(403);res.end("Forbidden");return}
    try{const info=await stat(file);if(info.isDirectory())file=resolve(file,"index.html");await stat(file);}catch{file=resolve(root,"index.html");}
    const body=await readFile(file);
    res.writeHead(200,{"content-type":mime[extname(file).toLowerCase()]??"application/octet-stream","cache-control":extname(file)===".html"?"no-cache":"public, max-age=31536000, immutable"});
    res.end(req.method==="HEAD"?undefined:body);
  }catch{res.writeHead(500);res.end("Internal error");}
});
server.listen(port,()=>{console.log(`SKB 离线客户端已启动: http://localhost:${port}/  （游戏服务器: ${process.env.SKB_SERVER??"构建时注入"}）`);});
