#!/usr/bin/env node

import path from 'path'

import chalk from 'chalk'
import { config } from 'dotenv-defaults'
import Fastify from 'fastify'
import yargsParser from 'yargs-parser'

import { getPaths, getConfig } from '@redwoodjs/project-config'

import { redwoodFastifyWeb } from './web'
import { withApiProxy } from './withApiProxy'

interface Opts {
  socket?: string
  port?: string
  apiHost?: string
}

function isFullyQualifiedUrl(url: string) {
  try {
    // eslint-disable-next-line no-new
    new URL(url)
    return true
  } catch (e) {
    return false
  }
}

async function serve() {
  // Parse server file args
  const args = yargsParser(process.argv.slice(2), {
    string: ['port', 'socket', 'apiHost'],
    alias: { apiHost: ['api-host'], port: ['p'] },
  })

  const options: Opts = {
    socket: args.socket,
    port: args.port,
    apiHost: args.apiHost,
  }

  const redwoodProjectPaths = getPaths()
  const redwoodConfig = getConfig()

  const port = options.port ? parseInt(options.port) : redwoodConfig.web.port
  const apiUrl = redwoodConfig.web.apiUrl

  if (!options.apiHost && !isFullyQualifiedUrl(apiUrl)) {
    console.error(
      `${chalk.red('Error')}: If you don't provide ${chalk.magenta(
        'apiHost'
      )}, ${chalk.magenta(
        'apiUrl'
      )} needs to be a fully-qualified URL. But ${chalk.magenta(
        'apiUrl'
      )} is ${chalk.yellow(apiUrl)}.`
    )
    // We're using a custom error exit code here to tell `@redwoodjs/cli` that this error has been handled.
    // While any other exit code than `0` is considered an error, there seems to be some conventions around some of them
    // like `127`, etc. We chose 64 because it's in the range where there deliberately aren't any previous conventions.
    // See https://tldp.org/LDP/abs/html/exitcodes.html.
    process.exitCode = 64
    return
  }

  const tsServer = Date.now()

  // Load .env files
  config({
    path: path.join(redwoodProjectPaths.base, '.env'),
    defaults: path.join(redwoodProjectPaths.base, '.env.defaults'),
    multiline: true,
  })

  console.log(chalk.italic.dim('Starting Web Server...'))

  // Configure Fastify
  const fastify = Fastify({
    requestTimeout: 15_000,
    logger: {
      // Note: If running locally using `yarn rw serve` you may want to adust
      // the default non-development level to `info`
      level:
        process.env.LOG_LEVEL ?? process.env.NODE_ENV === 'development'
          ? 'debug'
          : 'warn',
    },
  })

  await fastify.register(redwoodFastifyWeb, {
    redwood: {
      ...options,
    },
  })

  // TODO: Could this be folded into redwoodFastifyWeb?
  // If apiHost is supplied, it means the functions are running elsewhere, so we should just proxy requests.
  if (options.apiHost) {
    // Attach plugin for proxying
    fastify.register(withApiProxy, { apiHost: options.apiHost, apiUrl })
  }

  let listenOptions:
    | { path: string; port?: never; host?: never }
    | { path?: never; port?: number; host?: string }

  if (options.socket) {
    listenOptions = { path: options.socket }
  } else {
    listenOptions = {
      port,
      host: process.env.NODE_ENV === 'production' ? '0.0.0.0' : '::',
    }
  }

  // Start
  fastify.listen(listenOptions).then(() => {
    console.log(chalk.italic.dim('Took ' + (Date.now() - tsServer) + ' ms'))
    if (options.socket) {
      console.log(`Web server started on ${options.socket}`)
    } else {
      console.log(`Web server started on http://localhost:${port}`)
    }
  })

  process.on('exit', () => {
    fastify.close()
  })
}

serve()
