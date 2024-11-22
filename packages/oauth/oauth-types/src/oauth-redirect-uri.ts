import { TypeOf, z, ZodIssueCode } from 'zod'
import { dangerousUrlSchema } from './common.js'
import { isLoopbackHost } from './util.js'

export type OAuthLoopbackRedirectURI =
  | `http://[::1]${string}`
  | `http://127.0.0.1${'' | `${':' | '/' | '?' | '#'}${string}`}`
export const oauthLoopbackRedirectURISchema = dangerousUrlSchema.superRefine(
  (value, ctx): value is OAuthLoopbackRedirectURI => {
    if (!value.startsWith('http://')) {
      ctx.addIssue({
        code: ZodIssueCode.custom,
        message: 'URL must use the "http:" protocol',
      })
      return false
    }

    const url = new URL(value)

    if (url.hostname === 'localhost') {
      // https://datatracker.ietf.org/doc/html/rfc8252#section-8.3
      ctx.addIssue({
        code: ZodIssueCode.custom,
        message:
          'Use of "localhost" for redirect uris is not allowed (RFC 8252)',
      })
      return false
    }

    if (!isLoopbackHost(url.hostname)) {
      ctx.addIssue({
        code: ZodIssueCode.custom,
        message:
          'HTTP redirect uris must use "127.0.0.1" or "[::1]" as the hostname',
      })
      return false
    }

    return true
  },
)

export type OAuthHttpsRedirectURI = `https://${string}`
export const oauthHttpsRedirectURISchema = dangerousUrlSchema.superRefine(
  (value, ctx): value is OAuthHttpsRedirectURI => {
    if (!value.startsWith('https://')) {
      ctx.addIssue({
        code: ZodIssueCode.custom,
        message: 'URL must use the "https:" protocol',
      })
      return false
    }

    const url = new URL(value)

    if (isLoopbackHost(url.hostname)) {
      // https://datatracker.ietf.org/doc/html/rfc8252#section-7.3
      //
      // > Loopback redirect URIs use the "http" scheme and are constructed
      // > with the loopback IP literal and whatever port the client is
      // > listening on. That is, "http://127.0.0.1:{port}/{path}" for IPv4,
      // > and "http://[::1]:{port}/{path}" for IPv6.
      ctx.addIssue({
        code: ZodIssueCode.custom,
        message:
          'loopback redirect uris must use the "http:" protocol, not "https:"',
      })
      return false
    }

    return true
  },
)

export type OAuthPrivateUseRedirectURI = `${string}.${string}:/${string}`
export const oauthPrivateUseRedirectURISchema = dangerousUrlSchema.superRefine(
  (value, ctx): value is OAuthPrivateUseRedirectURI => {
    const dotIdx = value.indexOf('.')
    const colonIdx = value.indexOf(':')

    // Optimization: avoid parsing the URL if the protocol does not contain a "."
    if (dotIdx === -1 || colonIdx === -1 || dotIdx > colonIdx) {
      ctx.addIssue({
        code: ZodIssueCode.custom,
        message:
          'Private-use URI scheme requires a "." as part of the protocol',
      })
      return false
    }

    const url = new URL(value)

    // Should be covered by the check before, but let's be extra sure
    if (!url.protocol.includes('.')) {
      ctx.addIssue({
        code: ZodIssueCode.custom,
        message: 'Invalid private-use URI scheme',
      })
      return false
    }

    if (url.hostname) {
      // https://datatracker.ietf.org/doc/html/rfc8252#section-7.1
      ctx.addIssue({
        code: ZodIssueCode.custom,
        message:
          'Private-use URI schemes must not include a hostname (only one "/" is allowed after the protocol, as per RFC 8252)',
      })
      return false
    }

    return true
  },
)

export const oauthRedirectUriSchema = z.union(
  [
    oauthLoopbackRedirectURISchema,
    oauthHttpsRedirectURISchema,
    oauthPrivateUseRedirectURISchema,
  ],
  {
    message: `URL must use the "https:" or "http:" protocol, or a private-use URI scheme (RFC 8252)`,
  },
)

export type OAuthRedirectUri = TypeOf<typeof oauthRedirectUriSchema>
