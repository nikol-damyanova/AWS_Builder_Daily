"""Setup and operate the dedicated workflow from AWS CloudShell."""
import boto3, json, pathlib, subprocess, sys, os
from datetime import datetime,timedelta,time,timezone
from zoneinfo import ZoneInfo
ROOT=pathlib.Path(__file__).parent
D=json.loads((ROOT/'deployment.json').read_text())
S=boto3.Session(region_name=D['region'])
A=S.client('bedrock-agentcore')
T=S.resource('dynamodb').Table(D['StateTable'])
B='aws.browser.v1'
cmd=sys.argv[1] if len(sys.argv)>1 else 'status'
if cmd=='login':
    session=A.start_browser_session(browserIdentifier=B,name='BuilderSignIn',sessionTimeoutSeconds=900)
    (ROOT/'login-session.json').write_text(json.dumps(session,default=str))
    # This helper navigates only to Builder; it does not enter or export credentials.
    subprocess.run(['node','login.mjs'],cwd=ROOT,check=True)
    print(f"Open https://{D['region']}.console.aws.amazon.com/bedrock-agentcore/browser/{B}/session/{session['sessionId']}?region={D['region']}")
    print('Take control and sign in ONLY to builder.aws.com. Then run python admin.py save-login.')
elif cmd=='save-login':
    session=json.loads((ROOT/'login-session.json').read_text())
    subprocess.run(['node','login.mjs','verify'],cwd=ROOT,check=True)
    A.save_browser_session_profile(profileIdentifier=D['ProfileId'],browserIdentifier=B,sessionId=session['sessionId'])
    A.stop_browser_session(browserIdentifier=B,sessionId=session['sessionId'])
    print('Dedicated Builder sign-in saved in AWS. Next run python admin.py preview.')
elif cmd=='preview':
    response=S.client('lambda').invoke(FunctionName=D['Function'],InvocationType='RequestResponse',Payload=b'{"mode":"preview"}')
    result=json.loads(response['Payload'].read())
    print(json.dumps(result,indent=2,ensure_ascii=False))
    if response.get('FunctionError'): raise SystemExit('Preview failed; posting remains disabled.')
elif cmd=='enable':
    if os.environ.get('CONFIRM_PUBLICATION') != 'YES':
        raise SystemExit(
            'Publishing is disabled by default. To explicitly enable it, '
            'set CONFIRM_PUBLICATION=YES and run this command again.'
        )
    preview=T.get_item(Key={'pk':'PREVIEW'},ConsistentRead=True).get('Item',{})
    if preview.get('status')!='PREVIEW_READY': raise SystemExit('An authenticated successful preview is required.')
    if datetime.now(timezone.utc)-datetime.fromisoformat(preview['createdAt'].replace('Z','+00:00'))>timedelta(hours=1): raise SystemExit('Preview is stale. Run preview again.')
    start=datetime.fromisoformat(D['startDay']).date()
    now=datetime.now(ZoneInfo('Europe/Sofia'))
    if start<=now.date(): raise SystemExit('Prepared start date has passed. Update the deployment expiry and start date before enabling.')
    end=start+timedelta(days=89)
    first=datetime.combine(start,time(12),ZoneInfo('Europe/Sofia'))
    stop=datetime.combine(end,time(23,59),ZoneInfo('Europe/Sofia'))
    # Keep the worker disabled unless scheduler creation succeeds.
    S.client('scheduler').create_schedule(Name=D['stack'],GroupName='default',ScheduleExpression='cron(0 12 * * ? *)',ScheduleExpressionTimezone='Europe/Sofia',StartDate=first.astimezone(timezone.utc)-timedelta(seconds=1),EndDate=stop.astimezone(timezone.utc),FlexibleTimeWindow={'Mode':'OFF'},State='ENABLED',ActionAfterCompletion='DELETE',Target={'Arn':D['FunctionArn'],'RoleArn':D['SchedulerRoleArn'],'Input':'{"mode":"scheduled"}','RetryPolicy':{'MaximumRetryAttempts':0,'MaximumEventAgeInSeconds':60}})
    T.update_item(Key={'pk':'CONFIG'},UpdateExpression='SET enabled=:v',ExpressionAttributeValues={':v':True})
    print(f'Enabled: {start} through {end}, noon Europe/Sofia. 90 calendar days; failures do not extend the window.')
elif cmd=='stop':
    T.update_item(Key={'pk':'CONFIG'},UpdateExpression='SET enabled=:v',ExpressionAttributeValues={':v':False})
    sch=S.client('scheduler')
    try:
        current=sch.get_schedule(Name=D['stack'],GroupName='default')
        allowed=['Name','GroupName','ScheduleExpression','ScheduleExpressionTimezone','StartDate','EndDate','FlexibleTimeWindow','Target','ActionAfterCompletion','Description','KmsKeyArn']
        sch.update_schedule(**{k:current[k] for k in allowed if k in current},State='DISABLED')
    except sch.exceptions.ResourceNotFoundException: pass
    print('Public actions disabled and schedule stopped.')
elif cmd=='status':
    data=T.scan(ProjectionExpression='pk, #s, detail, enabled, startDay',ExpressionAttributeNames={'#s':'status'})
    print(json.dumps(data.get('Items',[]),indent=2,default=str))
else: raise SystemExit('Use login, save-login, preview, enable, stop, or status.')
