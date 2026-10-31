"""Deploy disabled infrastructure. Run only after reviewing the IAM permissions."""
import boto3, json, pathlib, zipfile, os
from datetime import datetime, timedelta, timezone
from zoneinfo import ZoneInfo
ROOT=pathlib.Path(__file__).parent
REGION=boto3.Session().region_name or 'us-east-1'
STACK=os.environ.get('STACK_NAME', 'builder-daily-90')
EXPECTED_NAME=os.environ.get('EXPECTED_BUILDER_NAME', '').strip()
SESSION=boto3.Session(region_name=REGION)
sub=lambda v:{'Fn::Sub':v}
ref=lambda v:{'Ref':v}
arn=lambda v:{'Fn::GetAtt':[v,'Arn']}
def template():
    return {'AWSTemplateFormatVersion':'2010-09-09','Description':'Daily Builder workflow; disabled until authenticated preview is verified.','Parameters':{'CodeBucket':{'Type':'String'},'CodeKey':{'Type':'String'},'AccessEndsAt':{'Type':'String'}},'Resources':{
      'Profile':{'Type':'AWS::BedrockAgentCore::BrowserProfile','Properties':{'Name':'builder_daily_90','Description':'Dedicated Builder Center sign-in only'}},
      'State':{'Type':'AWS::DynamoDB::Table','Properties':{'BillingMode':'PAY_PER_REQUEST','AttributeDefinitions':[{'AttributeName':'pk','AttributeType':'S'}],'KeySchema':[{'AttributeName':'pk','KeyType':'HASH'}],'SSESpecification':{'SSEEnabled':True}}},
      'LogGroup':{'Type':'AWS::Logs::LogGroup','Properties':{'LogGroupName':sub('/aws/lambda/${AWS::StackName}'),'RetentionInDays':14}},
      'WorkerRole':{'Type':'AWS::IAM::Role','Properties':{'AssumeRolePolicyDocument':{'Version':'2012-10-17','Statement':[{'Effect':'Allow','Principal':{'Service':'lambda.amazonaws.com'},'Action':'sts:AssumeRole'}]},'Policies':[{'PolicyName':'DedicatedBuilderWorkflow','PolicyDocument':{'Version':'2012-10-17','Statement':[
        {'Effect':'Allow','Action':['logs:CreateLogStream','logs:PutLogEvents'],'Resource':arn('LogGroup')},
        {'Effect':'Allow','Action':['dynamodb:GetItem','dynamodb:PutItem','dynamodb:UpdateItem'],'Resource':arn('State')},
        {'Effect':'Allow','Action':['bedrock:InvokeModel'],'Resource':sub('arn:${AWS::Partition}:bedrock:${AWS::Region}::foundation-model/amazon.nova-micro-v1:0'),'Condition':{'DateLessThan':{'aws:CurrentTime':ref('AccessEndsAt')}}},
        {'Effect':'Allow','Action':['bedrock-agentcore:StartBrowserSession','bedrock-agentcore:StopBrowserSession','bedrock-agentcore:GetBrowserSession','bedrock-agentcore:ConnectBrowserAutomationStream','bedrock-agentcore:SaveBrowserSessionProfile'],'Resource':[sub('arn:${AWS::Partition}:bedrock-agentcore:${AWS::Region}:aws:browser/aws.browser.v1'),sub('arn:${AWS::Partition}:bedrock-agentcore:${AWS::Region}:${AWS::AccountId}:browser/aws.browser.v1'),{'Fn::GetAtt':['Profile','ProfileArn']}],'Condition':{'DateLessThan':{'aws:CurrentTime':ref('AccessEndsAt')}}}
      ]}}]}},
      'Worker':{'Type':'AWS::Lambda::Function','DependsOn':'LogGroup','Properties':{'FunctionName':ref('AWS::StackName'),'Runtime':'nodejs22.x','Handler':'index.handler','Role':arn('WorkerRole'),'MemorySize':512,'Timeout':210,'ReservedConcurrentExecutions':1,'Code':{'S3Bucket':ref('CodeBucket'),'S3Key':ref('CodeKey')},'Environment':{'Variables':{'STATE_TABLE':ref('State')}}}},
      'InvokeConfig':{'Type':'AWS::Lambda::EventInvokeConfig','Properties':{'FunctionName':ref('Worker'),'Qualifier':'$LATEST','MaximumRetryAttempts':0,'MaximumEventAgeInSeconds':60}},
      'SchedulerRole':{'Type':'AWS::IAM::Role','Properties':{'AssumeRolePolicyDocument':{'Version':'2012-10-17','Statement':[{'Effect':'Allow','Principal':{'Service':'scheduler.amazonaws.com'},'Action':'sts:AssumeRole','Condition':{'StringEquals':{'aws:SourceAccount':ref('AWS::AccountId')},'ArnEquals':{'aws:SourceArn':sub('arn:${AWS::Partition}:scheduler:${AWS::Region}:${AWS::AccountId}:schedule-group/default')}}}]},'Policies':[{'PolicyName':'InvokeOnlyBuilderWorker','PolicyDocument':{'Version':'2012-10-17','Statement':[{'Effect':'Allow','Action':'lambda:InvokeFunction','Resource':arn('Worker'),'Condition':{'DateLessThan':{'aws:CurrentTime':ref('AccessEndsAt')}}}]}}]}}
    },'Outputs':{'Function':{'Value':ref('Worker')},'FunctionArn':{'Value':arn('Worker')},'StateTable':{'Value':ref('State')},'ProfileId':{'Value':{'Fn::GetAtt':['Profile','ProfileId']}},'SchedulerRoleArn':{'Value':arn('SchedulerRole')}}}
def main():
    if not EXPECTED_NAME:
        raise SystemExit('Set EXPECTED_BUILDER_NAME to your Builder Center display name.')
    cf=SESSION.client('cloudformation')
    try:
        cf.describe_stacks(StackName=STACK)
    except cf.exceptions.ClientError as e:
        if 'does not exist' not in str(e): raise
    else: raise SystemExit('Stack already exists. Inspect it; this script never overwrites an existing deployment.')
    account=SESSION.client('sts').get_caller_identity()['Account']
    bucket=f'builder-daily-artifacts-{account}-{REGION}'
    s3=SESSION.client('s3')
    # Abort on a pre-existing bucket to avoid altering unrelated resources.
    try: s3.head_bucket(Bucket=bucket)
    except s3.exceptions.ClientError as e:
        if str(e.response['Error']['Code']) not in ('404','NoSuchBucket','NotFound'): raise
    else: raise SystemExit('Staging bucket already exists. Inspect it before retrying.')
    s3.create_bucket(Bucket=bucket)
    s3.put_public_access_block(Bucket=bucket,PublicAccessBlockConfiguration=dict(BlockPublicAcls=True,IgnorePublicAcls=True,BlockPublicPolicy=True,RestrictPublicBuckets=True))
    s3.put_bucket_encryption(Bucket=bucket,ServerSideEncryptionConfiguration={'Rules':[{'ApplyServerSideEncryptionByDefault':{'SSEAlgorithm':'AES256'}}]})
    s3.put_bucket_lifecycle_configuration(Bucket=bucket,LifecycleConfiguration={'Rules':[{'ID':'ExpireDeploymentPackages','Filter':{'Prefix':'code/'},'Status':'Enabled','Expiration':{'Days':7}}]})
    archive=ROOT/'lambda.zip'
    with zipfile.ZipFile(archive,'w',zipfile.ZIP_DEFLATED) as z:
        for p in [ROOT/'index.mjs',ROOT/'core.mjs']+list((ROOT/'node_modules').rglob('*')):
            if p.is_file(): z.write(p,p.relative_to(ROOT))
    key='code/lambda.zip'
    s3.upload_file(str(archive),bucket,key)
    start=(datetime.now(ZoneInfo('Europe/Sofia')).date()+timedelta(days=1))
    end=datetime.combine(start+timedelta(days=90),datetime.min.time(),ZoneInfo('Europe/Sofia')).astimezone(timezone.utc)
    t=template()
    (ROOT/'template.json').write_text(json.dumps(t,indent=2))
    cf.create_stack(StackName=STACK,TemplateBody=json.dumps(t),Capabilities=['CAPABILITY_IAM'],Parameters=[{'ParameterKey':'CodeBucket','ParameterValue':bucket},{'ParameterKey':'CodeKey','ParameterValue':key},{'ParameterKey':'AccessEndsAt','ParameterValue':end.isoformat().replace('+00:00','Z')}])
    cf.get_waiter('stack_create_complete').wait(StackName=STACK)
    outputs={x['OutputKey']:x['OutputValue'] for x in cf.describe_stacks(StackName=STACK)['Stacks'][0]['Outputs']}
    outputs.update(region=REGION,stack=STACK,startDay=start.isoformat(),accessEndsAt=end.isoformat(),codeBucket=bucket)
    (ROOT/'deployment.json').write_text(json.dumps(outputs,indent=2))
    SESSION.resource('dynamodb').Table(outputs['StateTable']).put_item(Item={'pk':'CONFIG','profileId':outputs['ProfileId'],'expectedName':EXPECTED_NAME,'enabled':False,'startDay':start.isoformat()})
    print('Infrastructure deployed. No schedule exists and posting is disabled. Next: python admin.py login')
if __name__=='__main__': main()
