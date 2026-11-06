import {handler} from './index.mjs'; const result=await handler({mode:process.argv[2]||'auth-check'}); console.log(JSON.stringify(result));
