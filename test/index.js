'use strict'

const path = require('path')
const pino = require('pino')
const log = pino({prettyPrint: true, level: 'trace'})
const casServer = require(path.join(__dirname, 'lib', 'casServer'))

const hapi = require('hapi')

const server = hapi.server({
  host: 'localhost',
  address: '127.0.0.1',
  port: 8080
})

const plugins = [
  {
    plugin: require('hapi-server-session'),
    options: {
      cookie: {
        isSecure: false
      }
    }
  },
  {
    plugin: require(path.join(__dirname, '..', 'plugin')),
    options: {
      casServerUrl: 'http://127.0.0.1:9000',
      localAppUrl: 'http://127.0.0.1:8080',
      endPointPath: '/casHandler',
      saveRawCAS: true,
      logger: log
    }
  }
]

;(async function () {
  await server.register(plugins)
  server.auth.strategy('casauth', 'cas', plugins[1].options)
  server.route({
    method: 'GET',
    path: '/foo',
    handler: async function (request, h) {
      return 123// request.session
    },
    config: {
      auth: 'casauth'
    }
  })
  await casServer.start()
  await server.start()
  await testServer()
  console.log(2)
})()
  .catch(function (err) {
    console.error(err.stack)
    process.exit(0)
  })

function testServer () {
  return new Promise(function (resolve, reject) {
    console.log('test server started at %s', server.info.uri)
    const request = require('request')
    request(
      {
        url: 'http://localhost:8080/foo',
        jar: true
      },
      function (error, response, body) {
        // TODO: WhyTF does /foo not exist?!
        if (error) return reject(error)
        casServer.stop()
          .then(function () {
            console.log('cas server stopped')
            return Promise.resolve()
          })
          .then(function () {
            return server.stop()
          })
          .then(function () {
            console.log('test server stopped')
            return Promise.resolve()
          })
          .then(function () {
            const assert = require('assert')
            const json = JSON.parse(body)
            assert.equal(json.username, 'foouser')
            assert.equal(json.rawCas['user_uuid'], '1234567-ghsld')
            console.log('test is successful')
          })
          .catch(function (err) {
            console.error(err.stack)
            process.exit(0)
          })
      }
    )
  })
}
