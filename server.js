var PORT = 8499;
var KEY = 'foobar!';

var net = require('net');
var encrypt = require('./encrypt.js');
var tables = encrypt.getTable(KEY);
var encryptTable = tables[0];
var decryptTable = tables[1];

function appendBuffer(left, right) {
    if (buf == null) {
        return right;
    }
    var buf = new Buffer(left.length + right.length);
    left.copy(buf, 0);
    right.copy(buf, left.length);
    return buf;
}

function inetNtoa(buf) {
    return buf[0] + '.' + buf[1] + '.' + buf[2] + '.' + buf[3];
}

function inetAton(ipStr) {
    var parts = ipStr.split('.');
    if (parts.length != 4) {
        return null;
    } else {
        var buf = new Buffer(4);
        for (var i = 0; i < 4; i++)
            buf[i] = +parts[i];
        return buf;
    }
}

var server = net.createServer(function (connection) { //'connection' listener
    console.log('server connected');

    var stage = 0, headerLength = 0, cmd = 0, remote = null, cachedPieces = [];

    connection.on('data', function (data) {
        encrypt.encrypt(decryptTable, data);
        if (stage == 5) {
            // pipe sockets
            remote.write(data);
            return;
        }
        if (stage == 0) {
            if (data.length != 3) {
                connection.end();
                return;
            } else {
                var tempBuf = new Buffer(2);
                tempBuf.write('\x05\x00', 0);
                encrypt.encrypt(encryptTable, tempBuf);
                connection.write(tempBuf);
                stage = 1;
                return;
            }
        }
        if (stage == 1) { // note this must be if, not else if!
            try {
                // +----+-----+-------+------+----------+----------+
                // |VER | CMD |  RSV  | ATYP | DST.ADDR | DST.PORT |
                // +----+-----+-------+------+----------+----------+
                // | 1  |  1  | X'00' |  1   | Variable |    2     |
                // +----+-----+-------+------+----------+----------+
                var addrtype = 0, addrLen = 0, remoteAddr = null,
                    remotePort = null;
                // cmd and addrtype
                cmd = data[1];
                addrtype = data[3];
                if (addrtype == 3) {
                    addrLen = data[4];
                } else if (addrtype != 1) {
                    console.log('unsupported addrtype: ' + addrtype);
                    connection.end();
                    return;
                }
                // read address and port
                if (addrtype == 1) {
                    remoteAddr = inetNtoa(data.slice(4, 8));
                    remotePort = data.readUInt16BE(9);
                    headerLength = 10;
                } else {
                    remoteAddr = data.slice(5, 5 + addrLen).toString('binary');
                    remotePort = data.readUInt16BE(5 + addrLen);
                    headerLength = 5 + addrLen + 2;
                }
                // connect remote server
                remote = net.connect(remotePort, remoteAddr, function () {
                    console.log('connecting ' + remoteAddr);
                    var ipBuf = inetAton(remote.remoteAddress);
                    if (ipBuf == null) {
                        connection.end();
                        return;
                    }
                    var buf = new Buffer(10);
                    buf.write('\x05\x00\x00\x01', 0, 4, 'binary');
                    ipBuf.copy(buf, 4);
                    buf.writeInt16BE(remote.remotePort, 8);
                    encrypt.encrypt(encryptTable, buf);
                    connection.write(buf);
                    for (var i = 0; i < cachedPieces.length; i++) {
                        var piece = cachedPieces[i];
                        remote.write(piece);
                    }
                    cachedPieces = null; // save memory
                    stage = 5;
                });
                remote.on('data', function (data) {
                    encrypt.encrypt(encryptTable, data);
                    connection.write(data);
                });
                remote.on('end', function () {
                    console.log('remote disconnected');
                    connection.end();
                });
                remote.on('error', function () {
                    console.log('remote error');
                    connection.end();
                });
                if (data.length > headerLength) {
                    // make sure no data is lost
                    var buf = new Buffer(data.length - headerLength);
                    data.copy(buf, 0, headerLength);
                    cachedPieces.push(buf);
                }
                stage = 4;
            } catch (e) {
                // may encouter index out of range
                console.log(e);
                connection.end();
            }
        } else if (stage == 4) { // note this must be else if, not if!
            console.log(4);
            // remote server not connected
            // cache received buffers
            // make sure no data is lost
            cachedPieces.push(data);
        }
    });
    connection.on('end', function () {
        console.log('server disconnected');
        if (remote) {
            remote.end();
        }
    });
    connection.on('error', function () {
        console.log('server error');
        if (remote) {
            remote.end();
        }
    });
});
server.listen(PORT, function () {
    console.log('server bound');
});
