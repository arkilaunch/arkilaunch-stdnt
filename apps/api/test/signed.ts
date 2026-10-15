// A valid checkout signature: the platform template version and a 1x1 PNG.
export const TINY_PNG =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=';
export const SIGNED = { agreement: { signedName: 'Test Signer', termsVersion: 'default-1', signaturePng: TINY_PNG } };
