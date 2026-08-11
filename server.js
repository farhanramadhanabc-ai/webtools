
import express from 'express';
import { chromium } from 'playwright';
import fs from 'fs';
import path from 'path';

const app = express();
const PORT = Number(process.env.PORT || 3000);
const PROFILE_ROOT = process.env.BROWSER_PROFILE_DIR || '/data/abc-browser-profile';

app.use(express.json({limit:'1mb'}));
app.use(express.static('public'));

const contexts = new Map();

function ensureDir(dir){
  fs.mkdirSync(dir,{recursive:true});
  fs.accessSync(dir,fs.constants.W_OK);
}

function getProfileDir(platform){
  const preferred=path.join(PROFILE_ROOT,platform);
  try{ensureDir(preferred);return preferred;}
  catch{
    const fallback=path.join('/tmp/abc-browser-profile',platform);
    ensureDir(fallback);
    return fallback;
  }
}

async function getContext(platform){
  if(contexts.has(platform)) return contexts.get(platform);
  const ctx=await chromium.launchPersistentContext(getProfileDir(platform),{
    headless:true,
    userAgent:'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
    viewport:{width:1440,height:1200},
    locale:'en-US',
    timezoneId:'Asia/Jakarta',
    colorScheme:'light',
    args:['--no-sandbox','--disable-setuid-sandbox','--disable-dev-shm-usage']
  });
  contexts.set(platform,ctx);
  return ctx;
}

async function withPage(platform,fn){
  const ctx=await getContext(platform);
  const page=await ctx.newPage();
  try{return await fn(page)}finally{await page.close().catch(()=>{})}
}

function cleanUsername(input,platform){
  let v=String(input||'').trim().replace(/^https?:\/\/(www\.)?/i,'');
  const prefixes={instagram:['instagram.com/'],tiktok:['tiktok.com/@'],facebook:['facebook.com/']};
  for(const p of (prefixes[platform]||[])) if(v.toLowerCase().startsWith(p)) v=v.slice(p.length);
  return v.split(/[/?#]/)[0].replace(/^@/,'').trim();
}
function normalizePhone(input){
  let n=String(input||'').replace(/[^\d+]/g,'').replace(/^\+/,'');
  if(n.startsWith('0'))n='62'+n.slice(1);
  return n;
}
function uniq(arr,key){
  const s=new Set();
  return arr.filter(x=>{const k=key(x);if(!k||s.has(k))return false;s.add(k);return true});
}
async function nav(page,url){
  let e;
  for(let i=0;i<2;i++){
    try{
      await page.goto(url,{waitUntil:'domcontentloaded',timeout:40000});
      await page.waitForTimeout(i?5000:3200);
      return;
    }catch(err){e=err;await page.waitForTimeout(1200)}
  }
  throw e;
}

async function instagramLookup(username){
  return withPage('instagram',async page=>{
    await nav(page,`https://www.instagram.com/${encodeURIComponent(username)}/`);
    const d=await page.evaluate(()=>{
      const body=document.body.innerText||'';
      const blocked=/accounts\/login|challenge|checkpoint/i.test(location.href)||
        /Log in|Sign up to see photos and videos|Create an account or log in to Instagram/i.test(body);
      const imgs=[...document.querySelectorAll('img')].map(img=>({
        src:img.currentSrc||img.src||'',alt:img.alt||'',w:img.naturalWidth||0,h:img.naturalHeight||0
      })).filter(x=>x.src&&!x.src.startsWith('data:'));
      const avatar=imgs.find(x=>/profile picture|profile photo/i.test(x.alt)&&!/instagram/i.test(x.alt))?.src||'';
      const posts=body.match(/([\d.,KMB]+)\s+posts/i)?.[1]||'';
      const followers=body.match(/([\d.,KMB]+)\s+followers/i)?.[1]||'';
      const following=body.match(/([\d.,KMB]+)\s+following/i)?.[1]||'';
      const heads=[...document.querySelectorAll('header h1,header h2,main h1,main h2')].map(x=>x.textContent?.trim()).filter(Boolean);
      const displayName=heads.find(x=>x.length<100&&!/instagram|followers|following|posts|log in|sign up/i.test(x))||'';
      let bio='';
      const header=document.querySelector('header');
      if(header){
        const lines=(header.innerText||'').split('\n').map(x=>x.trim()).filter(Boolean)
          .filter(x=>!/followers|following|posts|message|follow|edit profile|share profile/i.test(x));
        const idx=displayName?lines.findIndex(x=>x===displayName):-1;
        bio=lines.slice(idx>=0?idx+1:1,(idx>=0?idx+1:1)+5).join('\n');
      }
      const media=[];
      for(const a of [...document.querySelectorAll('a[href]')]){
        const href=a.getAttribute('href')||'';
        if(!/^\/(p|reel)\//.test(href))continue;
        const img=a.querySelector('img'); if(!img)continue;
        media.push({url:a.href,image:img.currentSrc||img.src||'',caption:img.alt||'',type:href.includes('/reel/')?'reel':'post'});
      }
      const highlights=[];
      for(const a of [...document.querySelectorAll('a[href*="/stories/highlights/"]')]){
        const img=a.querySelector('img'); if(!img)continue;
        highlights.push({title:a.innerText?.trim()||img.alt||'Highlight',image:img.currentSrc||img.src||'',url:a.href});
      }
      return {blocked,avatar,posts,followers,following,displayName,bio,media,highlights};
    });
    if(d.blocked)return {platform:'instagram',username,blocked:true,message:'Instagram membatasi profil publik untuk browser server pada sesi ini.'};
    return {
      platform:'instagram',username,displayName:d.displayName||username,avatar:d.avatar||'',bio:d.bio||'',
      metrics:[{label:'Posts',value:d.posts||'—'},{label:'Followers',value:d.followers||'—'},{label:'Following',value:d.following||'—'}],
      highlights:uniq(d.highlights||[],x=>x.url||x.image).slice(0,12),
      media:uniq(d.media||[],x=>x.url||x.image).slice(0,18),
      blocked:false
    };
  });
}

async function tiktokLookup(username){
  return withPage('tiktok',async page=>{
    await nav(page,`https://www.tiktok.com/@${encodeURIComponent(username)}`);
    const d=await page.evaluate(()=>{
      const meta=p=>document.querySelector(`meta[property="${p}"]`)?.content||document.querySelector(`meta[name="${p}"]`)?.content||'';
      const body=document.body.innerText||'';
      const title=meta('og:title')||document.title||'',avatar=meta('og:image')||'',bio=meta('og:description')||meta('description')||'';
      const find=re=>body.match(re)?.[1]||'';
      const media=[];
      for(const a of [...document.querySelectorAll('a[href*="/video/"]')]){
        const img=a.querySelector('img'); if(!img)continue;
        media.push({url:a.href,image:img.currentSrc||img.src||'',caption:img.alt||'',type:'video'});
      }
      return {title,avatar,bio,following:find(/([\d.,KMB]+)\s+Following/i),followers:find(/([\d.,KMB]+)\s+Followers/i),likes:find(/([\d.,KMB]+)\s+Likes/i),media};
    });
    return {platform:'tiktok',username,displayName:(d.title||username).replace(/\s*\(@.*$/,'').replace(/\s*\|\s*TikTok.*$/i,'').trim()||username,
      avatar:d.avatar,bio:d.bio,metrics:[{label:'Following',value:d.following||'—'},{label:'Followers',value:d.followers||'—'},{label:'Likes',value:d.likes||'—'}],
      highlights:[],media:uniq(d.media||[],x=>x.url||x.image).slice(0,18),blocked:false};
  });
}

async function facebookLookup(username){
  return withPage('facebook',async page=>{
    await nav(page,`https://www.facebook.com/${encodeURIComponent(username)}`);
    const d=await page.evaluate(()=>{
      const meta=p=>document.querySelector(`meta[property="${p}"]`)?.content||document.querySelector(`meta[name="${p}"]`)?.content||'';
      const body=document.body.innerText||'';
      const title=meta('og:title')||document.title||'',avatar=meta('og:image')||'',bio=meta('og:description')||meta('description')||'';
      const media=[...document.querySelectorAll('img')].map(img=>({image:img.currentSrc||img.src||'',caption:img.alt||'',type:'photo'})).filter(x=>x.image&&!x.image.startsWith('data:')&&x.image!==avatar);
      return {title,avatar,bio,followers:body.match(/([\d.,KMB]+)\s+followers/i)?.[1]||'',following:body.match(/([\d.,KMB]+)\s+following/i)?.[1]||'',media};
    });
    return {platform:'facebook',username,displayName:(d.title||username).replace(/\s*\|\s*Facebook.*$/i,'').trim()||username,
      avatar:d.avatar,bio:d.bio,metrics:[{label:'Followers',value:d.followers||'—'},{label:'Following',value:d.following||'—'}],
      highlights:[],media:uniq(d.media||[],x=>x.image).slice(0,18),blocked:false};
  });
}

async function whatsappLookup(number){
  return withPage('whatsapp',async page=>{
    await nav(page,`https://api.whatsapp.com/send/?phone=${encodeURIComponent(number)}&text&type=phone_number&app_absent=0`);
    const d=await page.evaluate(()=>{
      const imgs=[...document.querySelectorAll('img')].map(img=>({src:img.currentSrc||img.src||'',alt:img.alt||'',w:img.naturalWidth||0,h:img.naturalHeight||0})).filter(x=>x.src&&!x.src.startsWith('data:'));
      const avatar=imgs.find(x=>x.w>=70&&x.h>=70&&Math.abs(x.w-x.h)<25&&!/whatsapp/i.test(x.alt))?.src||'';
      const candidates=[...document.querySelectorAll('h1,h2,h3,strong,span,div')].map(el=>(el.textContent||'').trim()).filter(t=>t&&t.length>=2&&t.length<=80);
      const blacklist=/whatsapp|buka aplikasi|open app|continue to whatsapp|lanjutkan ke whatsapp web|download|unduh|login|fitur|privasi|blog|pusat bantuan|untuk bisnis/i;
      const displayName=candidates.find(t=>!blacklist.test(t)&&!/^\+?\d[\d\s-]+$/.test(t))||'';
      return {avatar,displayName};
    });
    let country='International',prefix='—';
    if(number.startsWith('62')){country='Indonesia';prefix='+62'}else if(number.startsWith('60')){country='Malaysia';prefix='+60'}else if(number.startsWith('65')){country='Singapore';prefix='+65'}
    return {platform:'whatsapp',normalized:'+'+number,displayName:d.displayName||'WhatsApp Profile',avatar:d.avatar||'',bio:'',
      metrics:[{label:'Country',value:country},{label:'Prefix',value:prefix},{label:'Digits',value:String(number.length)}],
      highlights:[],media:[],blocked:!(d.avatar||d.displayName),message:'WhatsApp tidak merender nama/foto untuk sesi browser ini.'};
  });
}

app.get('/api/engine-status',(req,res)=>res.json({mode:'browser-only',persistentStorage:PROFILE_ROOT.startsWith('/data/')}));
app.post('/api/lookup',async(req,res)=>{
  try{
    const {platform,query}=req.body||{};
    if(!platform||!query)return res.status(400).json({error:'Input belum lengkap.'});
    if(platform==='whatsapp'){
      const n=normalizePhone(query); if(n.length<8||n.length>15)return res.status(400).json({error:'Nomor tidak valid.'});
      return res.json(await whatsappLookup(n));
    }
    const username=cleanUsername(query,platform); if(!username)return res.status(400).json({error:'Username tidak valid.'});
    if(platform==='instagram')return res.json(await instagramLookup(username));
    if(platform==='tiktok')return res.json(await tiktokLookup(username));
    if(platform==='facebook')return res.json(await facebookLookup(username));
    return res.status(400).json({error:'Platform tidak didukung.'});
  }catch(e){console.error(e);res.status(500).json({error:'Browser lookup gagal. Coba lagi beberapa saat.'})}
});
app.listen(PORT,()=>console.log(`ABC Membership Tools running on :${PORT}`));
