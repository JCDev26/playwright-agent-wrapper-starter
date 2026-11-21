// Playwright accepts repeated --project options, multiple names and wildcard selectors.
module.exports = function testProfile(args) {
  const projects = [];
  for (let index = 0; index < args.length; index++) {
    const arg = args[index];
    if (arg !== '--project' && !arg.startsWith('--project=')) continue;
    if (arg.startsWith('--project=')) projects.push(arg.slice('--project='.length));
    while (index + 1 < args.length && !args[index + 1].startsWith('-')) projects.push(args[++index]);
  }
  if (!projects.length) return 'smoke';
  const names = ['unit', 'integration', 'smoke', 'performance', 'security', 'mobile-ios', 'mobile-android'];
  const matches = names.filter(name => projects.some(selector =>
    /^[a-z*-]+$/i.test(selector) &&
    new RegExp('^' + selector.split('*').join('.*') + '$', 'i').test(name)));
  if (matches.length && matches.every(name => name === 'unit')) return 'unit';
  if (matches.includes('mobile-ios')) {
    return matches.some(name => name !== 'mobile-ios' && name !== 'unit') ? 'all-browsers' : 'mobile-ios';
  }
  return 'smoke';
};
