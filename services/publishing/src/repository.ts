import {cloudEnabled,type AsyncCompatible} from '@unfold/cloud';
import {PublishingStore} from './store.ts';
import {PostgresPublishingStore} from './postgres-store.ts';
export type PublishingRepository=AsyncCompatible<PublishingStore>;
export function createPublishingRepository(databasePath:string):PublishingRepository{
 return cloudEnabled()?new PostgresPublishingStore(databasePath):new PublishingStore(databasePath);
}
