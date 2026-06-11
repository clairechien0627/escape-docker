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
    HostConfig: { ...info.HostConfig, NetworkMode: 'none' },
  };

  await container.remove({ force: true });

  const newContainer = await docker.createContainer(createOptions);

  const oldShortId = info.Id.substring(0, 12);
  const networks = info.NetworkSettings.Networks || {};
  for (const [netName, netInfo] of Object.entries(networks)) {
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
        stream.on('end', resolve);
        stream.on('error', reject);
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
