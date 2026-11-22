import path from 'node:path';
import {tmpdir} from 'node:os';
import {cloudEnabled,type AsyncCompatible} from '@unfold/cloud';
import {JobStore} from './store.ts';
import {PostgresJobStore} from './postgres-store.ts';
import {loadJobConfig} from './config.ts';
export type JobQueue=AsyncCompatible<JobStore>;
export function createJobQueue():JobQueue{
 if(cloudEnabled())return new PostgresJobStore({databasePath:'postgres',artifactRoot:path.join(tmpdir(),'unfold-cloud-jobs')});
 return new JobStore(loadJobConfig());
}
