import {chromium} from 'playwright-core';
import {DynamoDBClient} from '@aws-sdk/client-dynamodb';
import {DynamoDBDocumentClient, GetCommand, PutCommand, UpdateCommand, TransactWriteCommand} from '@aws-sdk/lib-dynamodb';
import {createHash} from 'node:crypto';
import {localDay, inWindow, articleUrl} from './core.mjs';
const region = process.env.AWS_REGION || 'us-east-1';
const db = DynamoDBDocumentClient.from(new DynamoDBClient({region}));
const table = process.env.STATE_TABLE;
const hash = s=>createHash('sha256').update(s).digest('hex');
async function config() { return (await db.send(new GetCommand({TableName:table, Key:{pk:'CONFIG'}, ConsistentRead:true}))).Item; }
async function saveStatus(pk, status, extra={}) {
  await db.send(new UpdateCommand({TableName:table,Key:{pk}, UpdateExpression:'SET #s = :s, updatedAt = :t, detail = :d',ExpressionAttributeNames:{'#s':'status'},ExpressionAttributeValues:{':s':status,':t':new Date().toISOString(),':d':extra}}));
}
export async function requireLogin(page, expectedName, expectedEmail) {
  const identity = page.getByRole('button',{name:expectedName,exact:true});
  try { await identity.waitFor({timeout:15000}); return; } catch {}
  // Let the site's existing SSO session renew authentication, without entering credentials.
  const signIn = page.getByRole('button',{name:'Sign in',exact:true});
  if (await signIn.isVisible()) {
    await signIn.click();
    if(expectedEmail){
      const email=page.getByRole('textbox',{name:'Email',exact:true});
      try { await email.waitFor({timeout:5000}); } catch {}
      if(await email.isVisible()){
        await email.fill(expectedEmail);
        await page.getByRole('button',{name:'Continue with Builder ID',exact:true}).click();
      }
    }
  }
  try { await identity.waitFor({timeout:25000}); }
  catch { throw new Error('SIGN_IN_REQUIRED'); }
}
async function latestArticle(page) {
  const latest = page.getByRole('button',{name:'Latest',exact:true});
  await latest.waitFor();
  if (await latest.getAttribute('aria-pressed') !== 'true') await latest.click();
  // Use the Explore feed only; Spotlight contains unrelated older articles.
  const feed = page.getByRole('main').getByRole('feed');
  const link = feed.getByRole('heading',{level:2}).getByRole('link').filter({hasText:/\S/});
  await link.first().waitFor();
  const hrefs = await link.evaluateAll(nodes=>nodes.map(n=>n.getAttribute('href')));
  const candidates = [...new Set(hrefs.filter(h=>h?.startsWith('/content/')).map(articleUrl))].slice(0,8);
  if (!candidates.length) throw new Error('NO_ARTICLE_IN_LATEST_FEED');
  for (const url of candidates) {
    await page.goto(url,{waitUntil:'domcontentloaded'});
    await page.getByRole('heading',{name:/^Comments \(/}).waitFor();
    await Promise.race([
      page.getByRole('group',{name:'Comment editor',exact:true}).waitFor(),
      page.getByText(/Comments aren’t available on this article/).waitFor()
    ]);
    if (await page.getByRole('group',{name:'Comment editor',exact:true}).isVisible()) return url;
  }
  throw new Error('NO_COMMENT_ENABLED_ARTICLE_IN_RECENT_FEED');
}
export async function inspectArticle(page) {
  const titles=await page.getByRole('heading',{level:1}).evaluateAll(nodes=>nodes.filter(n=>!n.closest('.slate-editor')).map(n=>n.innerText.trim()));
  if(titles.length!==1)throw new Error('ARTICLE_TITLE_NEEDS_VALIDATION');
  const title=titles[0];
  // Do not send navigation, recommendations, or other people's comments to the model.
  const article = page.getByRole('main').locator('.slate-editor[contenteditable="false"]');
  if (await article.count() !== 1) throw new Error('ARTICLE_BODY_SELECTOR_NEEDS_VALIDATION');
  const text = (await article.innerText()).trim();
  if (text.length < 100 || text.length > 100000) throw new Error('ARTICLE_BODY_UNSUITABLE');
  return {title, text:text.slice(0,30000)};
}
async function draftComment() {
  // The account owner's approved style: short positive phrases only.
  const comments=['Great post!','Very informative, thanks for sharing!','Interesting read!','Great read!','Thanks for sharing!'];
  return comments[parseInt(hash(localDay()).slice(0,8),16)%comments.length];
}
async function publish(page, comment) {
  // These locators must pass an authenticated preview before the schedule can be enabled.
  const like = page.getByRole('button',{name:/^Like this article/});
  if (await like.count() < 1 || await like.count() > 2) throw new Error('LIKE_SELECTOR_NEEDS_VALIDATION');
  const editor = page.getByRole('group',{name:'Comment editor',exact:true}).getByRole('textbox');
  if (await editor.count() !== 1) throw new Error('COMMENT_EDITOR_NEEDS_VALIDATION');
  const submit = page.getByRole('button',{name:/^(Post comment|Submit comment|Comment)$/});
  if (await submit.count() !== 1) throw new Error('COMMENT_BUTTON_NEEDS_VALIDATION');
  await editor.fill(comment);
  const state = await like.first().getAttribute('aria-pressed');
  if (!['true','false'].includes(state)) throw new Error('LIKE_STATE_UNKNOWN');
  if (state === 'false') await like.first().click();
  // Never retry submission after an ambiguous result.
  await submit.click({timeout:10000});
  await page.getByText(comment,{exact:true}).waitFor({timeout:20000});
  await page.reload({waitUntil:'domcontentloaded'});
  await page.getByText(comment,{exact:true}).waitFor({timeout:20000});
  await page.getByRole('button',{name:/^Like this article/}).and(page.locator('[aria-pressed="true"]')).first().waitFor({timeout:15000});
}
export async function handler(event={}) {
  const authCheck = event.mode === 'auth-check';
  const preview = event.mode === 'preview' || authCheck;
  if (!preview && event.mode !== 'scheduled' && event.mode !== 'recover-auth-failure') throw new Error('Unsupported invocation mode');
  const cfg = await config();
  if (!cfg?.expectedName || !cfg.expectedEmail) throw new Error('SETUP_REQUIRED');
  const day = localDay();
  if (!preview && (!cfg.enabled || !inWindow(day,cfg.startDay))) return {status:'DISABLED_OR_OUTSIDE_90_DAYS'};
  const dayKey = `DAY#${day}`;
  if (!preview) {
    try {
      const recovery=event.mode==='recover-auth-failure';
      const old=recovery?(await db.send(new GetCommand({TableName:table,Key:{pk:dayKey},ConsistentRead:true}))).Item:null;
      if(recovery && (old?.status!=='FAILED'||old?.detail?.reason!=='SIGN_IN_REQUIRED'||old?.detail?.url!==null||!old.updatedAt)) throw new Error('NO_SAFE_AUTH_RECOVERY');
      await db.send(new PutCommand({TableName:table,Item:{pk:dayKey,status:'STARTED',createdAt:new Date().toISOString(),...(old?{previousAttempt:old}:{})},
        ConditionExpression:old?'#s=:failed AND detail.reason=:reason AND detail.#u=:empty AND updatedAt=:oldTime':'attribute_not_exists(pk)',
        ...(old?{ExpressionAttributeNames:{'#s':'status','#u':'url'},ExpressionAttributeValues:{':failed':'FAILED',':reason':'SIGN_IN_REQUIRED',':empty':null,':oldTime':old.updatedAt}}:{})}));
    }
    catch(e) { if (e.name==='ConditionalCheckFailedException') return {status:'ALREADY_ATTEMPTED_TODAY'}; throw e; }
  }
  let browser, url, claimedArticle=false;
  try {
    browser = await chromium.connectOverCDP('http://127.0.0.1:9222', {timeout:30000});
    const context = browser.contexts()[0];
    if (!context) throw new Error('DEFAULT_BROWSER_CONTEXT_MISSING');
    const page = context.pages().at(-1) || await context.newPage();
    await page.setViewportSize({width:1280,height:800});
    page.setDefaultTimeout(15000);
    await page.goto('https://builder.aws.com/',{waitUntil:'domcontentloaded'});
    await requireLogin(page,cfg.expectedName,cfg.expectedEmail);
    if (authCheck) return {status:'AUTHENTICATED',profileReused:true};
    url = await latestArticle(page);
    const article = await inspectArticle(page);
    const comment = await draftComment();
    if (!comment) { if (!preview) await saveStatus(dayKey,'SKIPPED',{url,reason:'No useful grounded comment'}); return {status:'SKIPPED',url}; }
    if (preview) {
      // A preview is only ready when the actual authenticated controls have been inspected.
      const checks = {like:await page.getByRole('button',{name:/^Like this article/}).count(),editor:await page.getByRole('group',{name:'Comment editor',exact:true}).getByRole('textbox').count(),submit:await page.getByRole('button',{name:/^(Post comment|Submit comment|Comment)$/}).count()};
      const ready = checks.like >= 1 && checks.like <= 2 && checks.editor === 1 && checks.submit === 1;
      const result={status:ready?'PREVIEW_READY':'SELECTORS_NEED_VALIDATION',url,title:article.title,comment,checks};
      await db.send(new PutCommand({TableName:table,Item:{pk:'PREVIEW',...result,createdAt:new Date().toISOString()}}));
      return result;
    }
    try {
      await db.send(new TransactWriteCommand({TransactItems:[{Put:{TableName:table,Item:{pk:`ARTICLE#${hash(url)}`,url,status:'SUBMISSION_RESERVED',day},ConditionExpression:'attribute_not_exists(pk)'}},{Update:{TableName:table,Key:{pk:dayKey},UpdateExpression:'SET #s=:s, detail=:d',ExpressionAttributeNames:{'#s':'status'},ExpressionAttributeValues:{':s':'SUBMISSION_RESERVED',':d':{url,comment}}}}]}));
      claimedArticle=true;
    } catch(e) { if(e.name==='TransactionCanceledException') { await saveStatus(dayKey,'SKIPPED',{url,reason:'Article already reserved or processed'});return {status:'ALREADY_PROCESSED',url}; } throw e; }
    // Recheck the kill switch immediately before public actions.
    if (!(await config())?.enabled) { await saveStatus(dayKey,'STOPPED'); return {status:'STOPPED'}; }
    await publish(page,comment);
    await saveStatus(dayKey,'POSTED',{url,comment});
    await saveStatus(`ARTICLE#${hash(url)}`,'POSTED',{day});
    return {status:'POSTED',url,comment};
  } catch(e) {
    const reason = String(e.message).slice(0,250);
    if (!preview) await saveStatus(dayKey,claimedArticle?'NEEDS_REVIEW':'FAILED',{url:url||null,reason});
    console.error(JSON.stringify({day,status:'FAILED',reason}));
    // A failed run never automatically retries or posts another comment.
    throw new Error(reason);
  } finally {
    if (browser) await browser.close().catch(()=>{});
  }
}
