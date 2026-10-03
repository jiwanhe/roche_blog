/**
 * 角色網誌 — Roche Plugin v1
 * 偷看 TA 的私人 Blog：深度長文，基於完整 persona + 記憶
 * 特色：記憶清洗層——提取後剔除敏感字詞再送 API，避免生成失敗
 */
(function(){
'use strict';
const app={
  id:'blog-home',name:'角色網誌',icon:'chat_bubble',iconImage:'',

  async mount(container,roche){
    const BG='#FAFAF8',CARD='#fff',T1='#1a1a1a',T2='#555',T3='#999',BD='#E8E4DF',
          ACC='#2D5A27',ACCL='#F0F5EF',ACCD='#1E3D1A'; // 深綠文藝感

    // ── State ──
    const S={
      showSettings:false,generating:false,
      posts:[],   // [{title,content,mood,date,tags,wordCount}]
      cfg:{charId:'',charName:'',convId:'',userName:'',genCount:1,blogStyle:'personal'},
      charList:[],convList:[],
      imported:null,importMsg:'',importErr:false,
      lastError:'',autoFetching:false,
      detailIdx:null,
    };

    // ── Storage ──
    const load=async k=>{try{const s=await roche.storage.get(k);return s?JSON.parse(s):null}catch(_){return null}};
    const sv=async(k,v)=>{try{await roche.storage.set(k,JSON.stringify(v))}catch(_){}};
    Object.assign(S.cfg,(await load('blog_cfg'))||{});
    S.posts=(await load('blog_posts'))||[];
    S.imported=(await load('blog_imported'))||null;
    const saveCfg=()=>sv('blog_cfg',S.cfg);
    const savePosts=()=>sv('blog_posts',S.posts);
    const saveImported=()=>sv('blog_imported',S.imported);
    const cn=()=>S.cfg.charName||S.imported?.name||'角色';

    try{S.charList=await roche.character.list()||[]}catch(_){}
    try{S.convList=await roche.conversation.list()||[]}catch(_){}
    if(!S.cfg.userName){try{const u=await roche.persona.getActiveUserPersona();if(u)S.cfg.userName=u.name||u.handle||'';}catch(_){}}
    if(!S.cfg.charId&&S.charList.length){S.cfg.charId=S.charList[0].id;S.cfg.charName=S.charList[0].name}
    if(!S.cfg.convId&&S.convList.length){
      const match=S.convList.find(c=>c.contactId===S.cfg.charId||c.name===S.cfg.charName);
      S.cfg.convId=(match||S.convList[0]).conversationId||(match||S.convList[0]).id;
    }

    // ── 日期工具 ──
    function ds(d){return`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`}

    // ══════════════════════════════════════════
    //  敏感字詞清洗層（核心防護）
    // ══════════════════════════════════════════
    const SANITIZE_PATTERNS = [
      // 性行為相關（繁+簡）
      /高潮|做愛|做爱|性交|口交|肛交|自慰|手淫|勃起|射精|內射|内射|外射|潮吹|性愛|性爱|性慾|性欲|性癖|性奴|性虐|淫|慾火|欲火|肉體|肉体|裸體|裸体|裸露/g,
      // BDSM / 調教（繁+簡）
      /調教|绑缚|綁縛|繩縛|绳缚|繩藝|绳艺|捆綁|捆绑|鞭打|掌摑|掌掴|窒息|SM|BDSM|Dom|Sub|主奴|奴隸|奴隶|項圈|项圈|choker|皮鞭|蠟燭|蜡烛|夾子|口塞|口枷|束縛|束缚|受虐|施虐|臣服/gi,
      // 身體敏感部位（繁+簡）
      /陰莖|阴茎|陰道|阴道|陰蒂|阴蒂|乳頭|乳头|乳房|胸部|私處|私处|下體|下体|龜頭|龟头|睪丸|睾丸|子宮|子宫|G點|G点|前列腺|肛門|肛门|會陰|会阴/g,
      // 性玩具 / 情趣用品（繁+簡）
      /跳蛋|按摩棒|飛機杯|飞机杯|情趣|潤滑|润滑|避孕套|保險套|保险套|縮陰球|缩阴球|震動|震动|假陽具|假阳具|肛塞|尿道/g,
      // 親密行為描述（繁+簡）
      /插入|抽插|深入|舔|吸吮|撫摸私|抚摸私|愛撫|爱抚|前戲|前戏|後入|后入|騎乘|骑乘|體位|体位|69|口爆|顏射|颜射|吞精|精液|體液|体液/g,
      // 毒品 / 違法
      /毒品|大麻|可卡因|海洛因|冰毒|搖頭丸|迷藥|迷姦|強姦|強暴|性侵|猥褻/g,
      // 自殘 / 極端
      /自殺|自殘|割腕|跳樓|上吊|服毒/g,
    ];

    // 額外模式：整句刪除（如果一整句主要在描述性行為/調教場景）
    const SENTENCE_KILL_PATTERNS = [
      /引發.*連續.*高潮/,
      /施以.*深度.*調教/,
      /完成.*內射/,
      /邊緣控制/,
      /主導了.*調教/,
      /掌摑與/,
      /言語羞辱/,
      /深度調教/,
      /求歡/,/求欢/,
      /難耐渴求/,
      /情趣.*體驗/,/情趣.*体验/,
      /私密.*攝影/,/私密.*摄影/,
      /皮質.*choker/i,/皮质.*choker/i,
      /下单.*绳艺/,/下單.*繩藝/,
      /训练器/,/訓練器/,
      /私密.*体验课/,/私密.*體驗課/,
    ];

    function sanitizeText(text){
      if(!text)return '';
      let cleaned = String(text);
      // 1. 整句刪除：如果句子命中刪句模式，直接移除整句
      const sentences = cleaned.split(/[。！？\n]+/);
      const safeSentences = sentences.filter(s => {
        const trimmed = s.trim();
        if(!trimmed) return true;
        return !SENTENCE_KILL_PATTERNS.some(p => p.test(trimmed));
      });
      cleaned = safeSentences.join('。');
      // 2. 關鍵詞替換：殘留的敏感詞替換成 ***
      SANITIZE_PATTERNS.forEach(p => {
        cleaned = cleaned.replace(p, '***');
      });
      // 3. 清理連續 *** 和多餘標點
      cleaned = cleaned.replace(/(\*{3}[，、。；：\s]*){2,}/g, '（私密內容已略）');
      cleaned = cleaned.replace(/\*{3}/g, '');
      // 4. 清理多餘空行
      cleaned = cleaned.replace(/\n{3,}/g, '\n\n').trim();
      return cleaned;
    }

    // 清洗 persona 文本（角色卡裡也可能有敏感內容）
    function sanitizePersona(persona){
      if(!persona)return '';
      let cleaned = sanitizeText(persona);
      // 額外：移除角色卡裡常見的 NSFW 區塊標記
      cleaned = cleaned.replace(/\[NSFW[^\]]*\][\s\S]*?\[\/NSFW\]/gi, '（私密設定已略）');
      cleaned = cleaned.replace(/<nsfw[^>]*>[\s\S]*?<\/nsfw>/gi, '（私密設定已略）');
      return cleaned;
    }

    // ── 自動抓取角色資料（含清洗）──
    async function fetchChar(){
      S.autoFetching=true;render();
      try{
        const im={importedAt:Date.now(),persona:'',personaClean:'',bio:'',coreSummary:'',coreSummaryClean:'',factMemories:[],factMemoriesClean:[],recentMessages:[],recentMessagesClean:[],name:'',handle:''};
        const cid=S.cfg.charId;
        if(cid){try{const f=await roche.character.get(cid);if(f){im.name=f.name||f.handle||'';im.handle=f.handle||'';im.persona=f.persona||'';im.bio=f.bio||'';}}catch(_){}}
        if(!im.name){const ch=S.charList.find(c=>c.id===cid);if(ch)im.name=ch.name||ch.handle||'';}
        try{
          const ltm=await roche.memory.getLongTerm();
          if(ltm?.core?.length)im.coreSummary=ltm.core.map(c=>c.summary||'').filter(Boolean).join('\n\n');
          if(ltm?.facts?.length)im.factMemories=ltm.facts.slice(0,10).map(f=>(f.action||'').slice(0,200)).filter(Boolean);
        }catch(_){}
        try{
          const stm=await roche.memory.getShortTerm();
          if(Array.isArray(stm))im.recentMessages=stm.filter(m=>!m.isMe&&m.text).slice(-20).map(m=>m.text);
        }catch(_){}

        // 清洗版本（送 API 用）
        im.personaClean=sanitizePersona(im.persona);
        im.coreSummaryClean=sanitizeText(im.coreSummary);
        im.factMemoriesClean=im.factMemories.map(f=>sanitizeText(f)).filter(t=>t.length>10); // 太短的清洗後沒意義就丟掉
        im.recentMessagesClean=im.recentMessages.map(m=>sanitizeText(m)).filter(t=>t.length>5);

        if(im.name||im.persona||im.coreSummary){
          S.imported=im;await saveImported();
          if(!S.cfg.charName)S.cfg.charName=im.name;
          toast('✨ 已抓取 '+im.name);
          const rawLen=im.persona.length+im.coreSummary.length;
          const cleanLen=im.personaClean.length+im.coreSummaryClean.length;
          S.importMsg=`原始 ${rawLen} 字 → 清洗後 ${cleanLen} 字（過濾 ${rawLen-cleanLen} 字敏感內容）\n記憶 ${im.factMemoriesClean.length}/${im.factMemories.length} 筆保留　語氣 ${im.recentMessagesClean.length} 則`;
          S.importErr=false;
        }else{S.importMsg='沒有抓到資料';S.importErr=true;}
      }catch(e){S.importMsg='失敗：'+e.message;S.importErr=true;}
      S.autoFetching=false;render();
    }

    // ── 建構 prompt context（只用清洗後的版本）──
    function buildCleanContext(){
      const im=S.imported;if(!im)return '';
      let c='';
      if(im.personaClean)c+=`\n【角色人設（已過濾敏感內容）】\n${im.personaClean}\n`;
      if(im.coreSummaryClean)c+=`\n【角色近況摘要】\n${im.coreSummaryClean}\n`;
      if(im.factMemoriesClean?.length)c+=`\n【近期事件】\n${im.factMemoriesClean.map((f,i)=>`${i+1}. ${f}`).join('\n')}\n`;
      if(im.recentMessagesClean?.length)c+=`\n【角色說話風格參考】\n${im.recentMessagesClean.slice(-8).map(t=>'- '+t).join('\n')}\n`;
      return c;
    }

    // ── API ──
    async function callAI(p,sys){
      const msgs=[];if(sys)msgs.push({role:'system',content:sys});msgs.push({role:'user',content:p});
      const r=await roche.ai.chat({messages:msgs,max_tokens:8000});
      if(!r)throw new Error('AI 回應為空');return r.text||r.choices?.[0]?.message?.content||'';
    }
    function parseJSON(raw){const c=raw.replace(/```json\s*/gi,'').replace(/```\s*/g,'').trim();try{return JSON.parse(c)}catch(_){}const m=c.match(/\[[\s\S]*\]/);if(m)try{return JSON.parse(m[0])}catch(_){}const m2=c.match(/\{[\s\S]*\}/);if(m2)try{return JSON.parse(m2[0])}catch(_){}return null;}

    // ── Blog 風格定義 ──
    const BLOG_STYLES={
      personal:{label:'私人日記',desc:'最內心的獨白，只寫給自己看的',prompt:'寫一篇私人日記/心情隨筆。像是角色深夜一個人對著螢幕寫下的真實想法，不修飾、不表演。可以是對某件事的反思、對某個人的想法、對自己的審視。'},
      essay:{label:'隨筆雜文',desc:'有觀點有深度的思考文章',prompt:'寫一篇有深度的隨筆雜文。角色針對某個話題展開自己的思考——可以是社會觀察、人生感悟、工作反思、閱讀心得。文章要有自己的觀點和邏輯。'},
      review:{label:'評論/推薦',desc:'書影音食物任何東西的深度評價',prompt:'寫一篇深度評論或推薦文。角色最近體驗/閱讀/觀看了某樣東西，寫出完整的感受和評價。不是流水帳式的記錄，而是有角色個人觀點和審美判斷的評論。'},
      letter:{label:'未寄出的信',desc:'寫給某人但不會真的寄出的信',prompt:'寫一封未寄出的信。角色想對某個人（伴侶、朋友、家人、過去的自己）說的話，但不會真的發出去。情感要真實、有層次，可以有猶豫、矛盾、溫柔或愧疚。'},
      fiction:{label:'微小說',desc:'角色風格的極短篇創作',prompt:'寫一篇極短篇微小說（虛構）。故事風格要符合角色的審美和內在世界觀。可以是寓言、都市奇幻、極短推理、意識流片段。'},
    };

    // ═══ 生成網誌 ═══
    async function genBlog(){
      if(S.generating)return;S.generating=true;S.lastError='';render();
      const name=cn(),ctx=buildCleanContext();
      const styleKey=S.cfg.blogStyle||'personal';
      const styleDef=BLOG_STYLES[styleKey]||BLOG_STYLES.personal;

      const sys=`你是一個深度寫作引擎。你的任務是以「${name}」的身份，用TA的思維方式、語氣和價值觀來寫作。
核心規則：
- 完全以角色第一人稱寫作，像是角色自己坐在電腦前打字
- 文字風格要貼合角色的個性和說話方式（參考提供的人設和語氣樣本）
- 長度 600-1200 字，要有深度和層次，不是表面流水帳
- 內容必須全年齡適合（SFW），不包含任何性暗示、暴力、敏感話題
- 可以提到日常生活、工作、興趣、人際關係（用含蓄的方式），但絕對不涉及私密細節
- 如果角色近期有發生事件，可以作為靈感來源，但轉化成適合公開的表達方式
- 標題要有文學感，不要太直白
- 回覆 JSON：{"title":"標題","content":"正文","mood":"一個能概括心情的詞","tags":["標籤1","標籤2","標籤3"],"date":"日期"}
- 只回 JSON，不要有任何其他文字`;

      const p=`${styleDef.prompt}\n\n角色資料：\n${ctx||'（無額外資料，請根據角色名稱自由發揮）'}\n\n隨機種子：${Date.now()}`;

      try{
        const raw=await callAI(p,sys);
        let parsed=parseJSON(raw);
        if(!parsed||!parsed.title)throw new Error('JSON 解析失敗：'+raw.slice(0,120));
        if(!Array.isArray(parsed))parsed=[parsed];
        const news=parsed.map((p,i)=>({
          ...p,
          id:'blog_'+Date.now()+'_'+i,
          author:name,
          date:p.date||ds(new Date()),
          style:styleKey,
          styleLabel:styleDef.label,
          wordCount:(p.content||'').length,
        }));
        S.posts=[...news,...S.posts];savePosts();
        toast('✍️ 發布了新網誌');
      }catch(e){S.lastError=e.message;toast('⚠ 生成失敗');}
      S.generating=false;render();
    }

    // ── Style ──
    const style=document.createElement('style');
    style.textContent=`
      .bg{width:100%;height:100%;position:relative;overflow:hidden;font-family:"Noto Serif TC","Georgia","Times New Roman",serif;background:${BG};display:flex;flex-direction:column;color:${T1}}
      .bg *{box-sizing:border-box}
      .bg-hdr{height:50px;display:flex;align-items:center;justify-content:space-between;padding:0 14px;border-bottom:1px solid ${BD};flex-shrink:0;background:${CARD}}
      .bg-hdr-btn{width:34px;height:34px;display:flex;align-items:center;justify-content:center;background:none;border:none;border-radius:50%;cursor:pointer;color:${T1}}
      .bg-body{flex:1;overflow-y:auto;padding:0 0 20px}
      .bg-hero{padding:32px 20px 24px;text-align:center;border-bottom:1px solid ${BD};background:${CARD}}
      .bg-hero-name{font-size:24px;font-weight:700;letter-spacing:2px;color:${T1}}
      .bg-hero-sub{font-size:13px;color:${T3};margin-top:4px;font-family:-apple-system,sans-serif}
      .bg-card{margin:16px;padding:20px;background:${CARD};border-radius:12px;border:1px solid ${BD};cursor:pointer;transition:box-shadow .2s}
      .bg-card:hover{box-shadow:0 4px 16px rgba(0,0,0,.06)}
      .bg-card-date{font-size:11px;color:${T3};font-family:-apple-system,sans-serif;letter-spacing:1px}
      .bg-card-title{font-size:18px;font-weight:700;margin-top:6px;line-height:1.5;color:${T1}}
      .bg-card-excerpt{font-size:14px;color:${T2};margin-top:8px;line-height:1.7;display:-webkit-box;-webkit-line-clamp:3;-webkit-box-orient:vertical;overflow:hidden}
      .bg-card-meta{display:flex;gap:12px;margin-top:12px;font-size:11px;color:${T3};font-family:-apple-system,sans-serif}
      .bg-card-tag{background:${ACCL};color:${ACC};padding:2px 8px;border-radius:4px}
      .bg-empty{text-align:center;padding:80px 20px;color:${T3}}
      .bg-empty .icon{font-size:48px;margin-bottom:12px}
      .bg-btn{padding:12px 28px;border-radius:24px;background:${ACC};color:#fff;border:none;font-weight:700;font-size:14px;cursor:pointer;font-family:-apple-system,sans-serif}
      .bg-btn:disabled{opacity:.4}
      .bg-btn-o{padding:8px 22px;border-radius:20px;background:${BG};color:${ACC};border:1.5px solid ${BD};font-weight:600;font-size:13px;cursor:pointer;display:inline-flex;align-items:center;gap:6px;font-family:-apple-system,sans-serif}
      /* Detail */
      .bg-dt{position:absolute;inset:0;z-index:100;background:${BG};overflow-y:auto;display:flex;flex-direction:column}
      .bg-dt-body{padding:24px 20px 60px;max-width:640px;margin:0 auto}
      .bg-dt-date{font-size:12px;color:${T3};letter-spacing:1px;font-family:-apple-system,sans-serif}
      .bg-dt-title{font-size:22px;font-weight:700;margin-top:8px;line-height:1.5}
      .bg-dt-mood{display:inline-block;margin-top:8px;padding:3px 12px;border-radius:16px;background:${ACCL};color:${ACC};font-size:12px;font-family:-apple-system,sans-serif}
      .bg-dt-content{font-size:16px;line-height:2;margin-top:20px;color:${T1};white-space:pre-wrap}
      .bg-dt-tags{margin-top:24px;display:flex;gap:8px;flex-wrap:wrap}
      .bg-dt-tags span{font-size:12px;color:${ACC};background:${ACCL};padding:3px 10px;border-radius:4px;font-family:-apple-system,sans-serif}
      .bg-dt-wc{margin-top:16px;font-size:11px;color:${T3};text-align:right;font-family:-apple-system,sans-serif}
      /* Settings */
      .bg-mask{position:absolute;inset:0;z-index:200;background:rgba(0,0,0,.45);display:flex;align-items:flex-end}
      .bg-set{width:100%;background:${CARD};border-radius:16px 16px 0 0;padding:18px;max-height:80%;overflow-y:auto;font-family:-apple-system,sans-serif}
      .bg-sl{display:block;font-size:12px;font-weight:600;color:${T2};margin:10px 0 4px}
      .bg-si{width:100%;padding:9px 12px;border-radius:10px;border:1px solid ${BD};font-size:13px;outline:none;background:#FAFAFA;font-family:inherit}
      .bg-sbtn{width:100%;padding:11px 0;border-radius:24px;background:${ACC};color:#fff;border:none;font-weight:700;font-size:14px;margin-top:14px;cursor:pointer}
      .bg-styles{display:flex;flex-wrap:wrap;gap:6px;margin-top:4px}
      .bg-style-btn{padding:8px 14px;border-radius:10px;border:1.5px solid ${BD};background:${CARD};color:${T2};font-size:12px;cursor:pointer;text-align:left}
      .bg-style-btn.on{border-color:${ACC};background:${ACCL};color:${ACC}}
      .bg-style-label{font-weight:600}
      .bg-style-desc{font-size:10px;color:${T3};margin-top:2px}
      .bg-toast{position:absolute;top:60px;left:50%;transform:translateX(-50%);background:rgba(0,0,0,.7);color:#fff;padding:8px 18px;border-radius:20px;font-size:13px;z-index:300;pointer-events:none;font-family:-apple-system,sans-serif;animation:bf .3s}
      @keyframes bf{from{opacity:0;transform:translateX(-50%) translateY(-8px)}to{opacity:1;transform:translateX(-50%) translateY(0)}}
    `;
    container.appendChild(style);

    function esc(s){return s?String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'):''}
    function toast(m){const t=document.createElement('div');t.className='bg-toast';t.textContent=m;root.appendChild(t);setTimeout(()=>t.remove(),2500)}

    // ── Render ──
    const root=document.createElement('div');root.className='bg';container.appendChild(root);
    function render(){
      let h='';
      h+=`<div class="bg-hdr"><button class="bg-hdr-btn" data-a="exit"><svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M15 18l-6-6 6-6"/></svg></button><span style="font-weight:700;font-size:16px;letter-spacing:1px">📖 網誌</span><button class="bg-hdr-btn" data-a="settings"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="${T2}" stroke-width="2"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg></button></div>`;
      h+=`<div class="bg-body">`;

      // Hero
      h+=`<div class="bg-hero"><div class="bg-hero-name">${esc(cn())}</div><div class="bg-hero-sub">的私人網誌 · ${S.posts.length} 篇文章</div></div>`;

      // Error
      if(S.lastError)h+=`<div style="margin:12px 16px;padding:10px;border-radius:10px;background:#FFF5F5;border:1px solid #FFDDDD;font-size:12px;color:#CC3333;font-family:-apple-system,sans-serif">⚠ ${esc(S.lastError)}</div>`;

      // Generate bar
      const styleLabel=BLOG_STYLES[S.cfg.blogStyle||'personal']?.label||'私人日記';
      h+=`<div style="margin:16px;display:flex;gap:8px;align-items:center"><button class="bg-btn" data-a="gen-blog" style="flex:1" ${S.generating?'disabled':''}>${S.generating?'✍️ 寫作中...':'✍️ 寫一篇「'+esc(styleLabel)+'」'}</button></div>`;

      // Posts
      if(!S.posts.length){
        h+=`<div class="bg-empty"><div class="icon">📝</div><p style="font-family:-apple-system,sans-serif">TA 的網誌還是空白的<br>先到設定選擇角色，再按上面的按鈕生成</p></div>`;
      }else{
        S.posts.forEach((p,i)=>{
          h+=`<div class="bg-card" data-a="open" data-i="${i}"><div class="bg-card-date">${esc(p.date)} · ${esc(p.styleLabel||'')}</div><div class="bg-card-title">${esc(p.title)}</div><div class="bg-card-excerpt">${esc(p.content)}</div><div class="bg-card-meta">${p.mood?`<span class="bg-card-tag">${esc(p.mood)}</span>`:''}${p.wordCount?`<span>${p.wordCount} 字</span>`:''}</div></div>`;
        });
      }
      h+=`</div>`;

      if(S.detailIdx!=null&&S.posts[S.detailIdx])h+=vDetail(S.posts[S.detailIdx]);
      if(S.showSettings)h+=vSettings();
      root.innerHTML=h;
    }

    function vDetail(p){
      return `<div class="bg-dt"><div class="bg-hdr" style="border-bottom:1px solid ${BD}"><button class="bg-hdr-btn" data-a="close-dt"><svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M15 18l-6-6 6-6"/></svg></button><span style="font-weight:700;font-size:14px">${esc(cn())} 的網誌</span><div style="width:34px"></div></div><div style="flex:1;overflow-y:auto"><div class="bg-dt-body"><div class="bg-dt-date">${esc(p.date)} · ${esc(p.styleLabel||'')}</div><div class="bg-dt-title">${esc(p.title)}</div>${p.mood?`<div class="bg-dt-mood">${esc(p.mood)}</div>`:''}<div class="bg-dt-content">${esc(p.content)}</div>${p.tags?.length?`<div class="bg-dt-tags">${p.tags.map(t=>`<span>#${esc(t)}</span>`).join('')}</div>`:''}<div class="bg-dt-wc">${p.wordCount||0} 字</div></div></div></div>`;
    }

    function vSettings(){
      const c=S.cfg;
      let h=`<div class="bg-mask"><div class="bg-set"><div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:14px"><span style="font-weight:700;font-size:15px">設定</span><button data-a="close-set" style="background:none;border:none;font-size:18px;color:${T3};cursor:pointer">✕</button></div>`;
      h+=`<label class="bg-sl">偷看誰的網誌？</label><select class="bg-si" data-f="charId">${S.charList.map(ch=>`<option value="${esc(ch.id)}" ${ch.id===c.charId?'selected':''}>${esc(ch.name||ch.handle)}</option>`).join('')}</select>`;
      h+=`<label class="bg-sl">文章風格</label><div class="bg-styles">${Object.entries(BLOG_STYLES).map(([k,v])=>`<div class="bg-style-btn ${k===(c.blogStyle||'personal')?'on':''}" data-a="set-style" data-style="${k}"><div class="bg-style-label">${v.label}</div><div class="bg-style-desc">${v.desc}</div></div>`).join('')}</div>`;
      h+=`<button data-a="fetch-char" class="bg-sbtn" style="background:#333;margin-top:12px" ${S.autoFetching?'disabled':''}>${S.autoFetching?'⏳ 抓取中...':'🚀 自動抓取角色資料（含敏感內容過濾）'}</button>`;
      if(S.imported){
        h+=`<div style="font-size:11px;color:${T2};background:#f5f5f5;border-radius:8px;padding:8px;margin-top:8px">已抓取：<strong>${esc(S.imported.name)}</strong><br>${esc(S.importMsg||'')}</div>`;
      }
      h+=`<button data-a="save-set" class="bg-sbtn">儲存設定</button>`;
      h+=`<button data-a="clear-all" class="bg-sbtn" style="background:#fff;color:#CC3333;border:1px solid #CC3333;margin-top:8px">🗑️ 清除所有文章</button>`;
      h+=`</div></div>`;
      return h;
    }

    // ── Events ──
    function onClick(e){
      const b=e.target.closest('[data-a]');if(!b)return;
      const a=b.dataset.a;
      if(a==='exit')roche.ui?.closeApp?.();
      else if(a==='settings'){S.showSettings=true;render();}
      else if(a==='close-set'){S.showSettings=false;render();}
      else if(a==='close-dt'){S.detailIdx=null;render();}
      else if(a==='gen-blog'){genBlog();}
      else if(a==='open'){const i=parseInt(b.dataset.i);if(!isNaN(i)&&S.posts[i]){S.detailIdx=i;render();}}
      else if(a==='set-style'){S.cfg.blogStyle=b.dataset.style;render();}
      else if(a==='fetch-char'){
        root.querySelectorAll('[data-f]').forEach(el=>{S.cfg[el.dataset.f]=el.value;});
        const ch=S.charList.find(c=>c.id===S.cfg.charId);if(ch)S.cfg.charName=ch.name||ch.handle||'';
        saveCfg();fetchChar();
      }
      else if(a==='save-set'){
        root.querySelectorAll('[data-f]').forEach(el=>{S.cfg[el.dataset.f]=el.value;});
        const ch=S.charList.find(c=>c.id===S.cfg.charId);if(ch)S.cfg.charName=ch.name||ch.handle||'';
        saveCfg();S.showSettings=false;toast('已儲存');render();
      }
      else if(a==='clear-all'){S.posts=[];savePosts();S.showSettings=false;toast('已清除');render();}
    }
    root.addEventListener('click',onClick);
    render();
    this._el=root;this._st=style;this._fn=onClick;
  },

  async unmount(container){
    if(this._el){this._el.removeEventListener('click',this._fn);this._el.remove();}
    if(this._st)this._st.remove();
    container.replaceChildren();
  }
};
window.RochePlugin.register({id:'roche-blog',name:'角色網誌',version:'1.0.0',description:'偷看 TA 的私人網誌',author:'予佟',apps:[app]});
})();
