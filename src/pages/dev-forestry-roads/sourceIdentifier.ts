/**
 * A business identifier as BC tenure and RESULTS records spell it: licence, cutting permit, block, timber mark,
 * client or road section. Tree farm licence timber marks carry a slash (`52/14F`) and some road sections a space
 * (`FIVA 9210`), so both are allowed, one space at a time and never at either end. Quotes, wildcards and other
 * punctuation are not, so a code can go into a query's quoted string as it is.
 */
export const SOURCE_IDENTIFIER = /^[A-Za-z0-9](?:[A-Za-z0-9_.:/-]| (?=[A-Za-z0-9_.:/-])){0,79}$/
