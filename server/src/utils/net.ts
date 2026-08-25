import { BlockList, isIP } from 'node:net';

const privateRanges = new BlockList();
privateRanges.addSubnet('10.0.0.0', 8, 'ipv4');
privateRanges.addSubnet('172.16.0.0', 12, 'ipv4');
privateRanges.addSubnet('192.168.0.0', 16, 'ipv4');
privateRanges.addSubnet('127.0.0.0', 8, 'ipv4');
privateRanges.addSubnet('::1', 128, 'ipv6');
privateRanges.addSubnet('169.254.0.0', 16, 'ipv4');
privateRanges.addSubnet('fe80::', 10, 'ipv6');
privateRanges.addSubnet('fc00::', 7, 'ipv6');

/**
 * Whether an IPv4/IPv6 address is private.
 *
 * `BlockList.check()` defaults `type` to 'ipv4', so an IPv6 string ('::1', or
 * IPv4-mapped '::ffff:192.168.0.50') silently returns false without it. The
 * type comes from isIP so loopback, link-local, ULA and mapped peers all match.
 */
export function isPrivateIP(ip: string): boolean {
    const type = isIP(ip);
    if (type === 4) return privateRanges.check(ip, 'ipv4');
    if (type === 6) return privateRanges.check(ip, 'ipv6');
    return false;
}
