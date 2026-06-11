const Docker = require('dockerode');

const docker = new Docker({ socketPath: '/var/run/docker.sock' });

async function getContainerStatus(name) {
  try {
    const info = await docker.getContainer(name).inspect();
    return info.State.Running ? 'running' : 'stopped';
  } catch (err) {
    if (err.statusCode === 404) return 'missing';
    throw err;
  }
}

async function startContainer(name) {
  const container = docker.getContainer(name);
  const info = await container.inspect();
  if (!info.State.Running) {
    await container.start();
  }
}

async function stopContainer(name) {
  const container = docker.getContainer(name);
  const info = await container.inspect();
  if (info.State.Running) {
    await container.stop();
  }
}

async function recreateContainer(name) {
  const container = docker.getContainer(name);
  const info = await container.inspect();

  const oldShortId = info.Id.substring(0, 12);
  const networks = info.NetworkSettings.Networks || {};
  const primaryNetName = info.HostConfig.NetworkMode;

  // The primary network (matching HostConfig.NetworkMode) must be attached
  // via NetworkingConfig at creation time so its alias is applied to the
  // same auto-attachment Docker performs for NetworkMode — connecting to it
  // again afterwards would fail.
  const networkingConfig = { EndpointsConfig: {} };
  if (networks[primaryNetName]) {
    const netInfo = networks[primaryNetName];
    networkingConfig.EndpointsConfig[primaryNetName] = {
      IPAMConfig: netInfo.IPAMConfig,
      Aliases: (netInfo.Aliases || []).filter((a) => a !== oldShortId),
    };
  }

  const createOptions = {
    name,
    Image: info.Config.Image,
    Env: info.Config.Env,
    Cmd: info.Config.Cmd,
    Entrypoint: info.Config.Entrypoint,
    Hostname: info.Config.Hostname,
    Tty: info.Config.Tty,
    OpenStdin: info.Config.OpenStdin,
    Labels: info.Config.Labels,
    HostConfig: info.HostConfig,
    NetworkingConfig: networkingConfig,
  };

  await container.remove({ force: true });

  const newContainer = await docker.createContainer(createOptions);

  for (const [netName, netInfo] of Object.entries(networks)) {
    if (netName === primaryNetName) continue;
    const aliases = (netInfo.Aliases || []).filter((a) => a !== oldShortId);
    await docker.getNetwork(netName).connect({
      Container: newContainer.id,
      EndpointConfig: { IPAMConfig: netInfo.IPAMConfig, Aliases: aliases },
    });
  }

  await newContainer.start();
}

async function waitUntilReady(name, timeoutMs = 30000) {
  const container = docker.getContainer(name);
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    try {
      const exec = await container.exec({ Cmd: ['true'], AttachStdout: true, AttachStderr: true });
      const stream = await exec.start({});
      await new Promise((resolve, reject) => {
        // A paused stream never emits 'end' until its data is consumed —
        // resume() drains it so 'end' fires once the exec process exits.
        const timer = setTimeout(() => reject(new Error('exec stream timeout')), 5000);
        stream.on('end', () => { clearTimeout(timer); resolve(); });
        stream.on('error', (err) => { clearTimeout(timer); reject(err); });
        stream.resume();
      });
      const result = await exec.inspect();
      if (result.ExitCode === 0) return true;
    } catch {
      // container not ready yet — retry
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  return false;
}

module.exports = {
  docker,
  getContainerStatus,
  startContainer,
  stopContainer,
  recreateContainer,
  waitUntilReady,
};
