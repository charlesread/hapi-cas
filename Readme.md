# hapi-cas

This module provides a [Hapi framework][hapi] authentication plugin which
implements [CAS][cas] authentication. This module requires a session manger
plugin to be registered with the Hapi server under which the *hapi-cas* plugin
is registered. The [hapi-server-session][hss] is known to work.

The API is fully documented in the [api.md](api.md) document.

[hapi]: http://hapijs.com/
[cas]: http://jasig.github.io/cas/
[hss]: https://www.npmjs.com/package/hapi-server-session
[jsdoc]: http://usejsdoc.org/

# Install

```bash
$ npm install --save --production hapi-cas
```
 
# Example

A fully working example is provided as test case in the [test directory](test/).

```javascript
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
    plugin: require('hapi-cas'),
    options: {
      casServerUrl: 'https://example.com/cas/',
      localAppUrl: 'http://127.0.0.1:8080',
      endPointPath: '/casHandler'
    }
  }
]

;(async function () {
  await server.register(plugins)
  server.auth.strategy('casauth', 'cas', plugins[1].options)
  server.route({
    method: 'GET',
    path: '/',
    handler: async function (request, h) {
      return request.session
    },
    config: {
      auth: 'casauth'
    }
  })
  await server.start()
})()
  .catch(function (err) {
    console.error(err.stack)
    process.exit(0)
  })
```

# License

[MIT License](http://jsumners.mit-license.org/)
