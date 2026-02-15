import { decryptValueIfPresent, encryptValue } from './crypto-store';

type AccountTokenFields = {
  twitterAccessToken: string | null;
  twitterAccessTokenSecret: string | null;
};

export function encryptAccountTokens(input: AccountTokenFields): AccountTokenFields {
  return {
    twitterAccessToken: input.twitterAccessToken ? encryptValue(input.twitterAccessToken) : null,
    twitterAccessTokenSecret: input.twitterAccessTokenSecret ? encryptValue(input.twitterAccessTokenSecret) : null,
  };
}

export function decryptAccountTokens<T extends AccountTokenFields>(account: T): T {
  return {
    ...account,
    twitterAccessToken: decryptValueIfPresent(account.twitterAccessToken),
    twitterAccessTokenSecret: decryptValueIfPresent(account.twitterAccessTokenSecret),
  };
}
