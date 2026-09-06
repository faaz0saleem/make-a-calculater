import { LEGAL_POLICIES } from '../../../../content/legal';
import { pageMetadata } from '@/lib/seo/site';
import { PolicyPage } from '../_components/policy-page';

const policy = LEGAL_POLICIES[0];
export const metadata = pageMetadata(policy.title, policy.description, '/terms', false);
export default function Page() { return <PolicyPage policy={policy} />; }
