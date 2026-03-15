let uuidModule: any = null;

export async function getUUID(): Promise<string> {
  if (!uuidModule) {
    uuidModule = await import('uuid');
  }
  return uuidModule.v4();
}
