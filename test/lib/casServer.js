'use strict'

const fs = require('fs')
const path = require('path')

const failedXml =
  fs.readFileSync(path.join(__dirname, '..', 'fixtures', 'validateFailure.xml')).toString()
const successXml =
  fs.readFileSync(path.join(__dirname, '..', 'fixtures', 'validateSuccess.xml')).toString()

const hapi = require('hapi')
const server = hapi.server({
  host: 'localhost',
  address: '127.0.0.1',
  port: 9000
})

server.route({
  method: 'GET',
  path: '/login',
  handler: async function (request, h) {
    const returnUrl = decodeURIComponent(request.query.service)
    return h.response()
      .header('cookie', request.headers.cookie)
      .redirect(returnUrl + '?ticket=ST-15394')
  }
})

server.route({
  method: 'GET',
  path: '/serviceValidate',
  handler: async function (request, h) {
    // const returnUrl = decodeURIComponent(request.query.service)
    const ticket = request.query.ticket
    let response
    if (ticket !== 'ST-15394') {
      response = h.response(failedXml)
    } else {
      response = h.response(successXml)
    }

    return response.header('cookie', request.headers.cookie)
  }
})

module.exports = server
