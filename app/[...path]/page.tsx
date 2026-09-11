import { Workspace } from '@/components/product/workspace';
export default async function Page({
  params,
}: {
  params: Promise<{ path: string[] }>;
}) {
  const { path } = await params;
  return <Workspace path={'/' + path.join('/')} />;
}
