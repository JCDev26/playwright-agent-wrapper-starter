// Additional flags (grep, workers, reporter) must not turn unit work into a browser workload.
module.exports = function testProfile(args) {
  const projects = [];
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === '--project') projects.push(args[++index]);
    else if (arg.startsWith('--project=')) projects.push(arg.slice('--project='.length));
  }
  return projects.length > 0 && projects.every(project => project === 'unit') ? 'unit' : 'smoke';
};
