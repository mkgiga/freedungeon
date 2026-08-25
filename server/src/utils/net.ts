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
 * Utility function to check if IPv4/IPv6 address is private.
 *
 * BlockList.check() defaults `type` to 'ipv4', so passing an IPv6 string
 * (e.g. '::1', or an IPv4-mapped '::ffff:192.168.0.50') without the type
 * would silently return false. Select the type from isIP so IPv6 loopback,
 * link-local, ULA, and IPv4-mapped peers are matched correctly.
 */
export function isPrivateIP(ip: string): boolean {
    const type = isIP(ip);
    if (type === 4) return privateRanges.check(ip, 'ipv4');
    if (type === 6) return privateRanges.check(ip, 'ipv6');
    return false;
}
