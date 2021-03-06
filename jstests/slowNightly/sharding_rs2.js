// mostly for testing mongos w/replica sets


s = new ShardingTest( "rs2" , 2 , 1 , 1 , { rs : true , chunksize : 1 } )

db = s.getDB( "test" )
t = db.foo

// -------------------------------------------------------------------------------------------
// ---------- test that config server updates when replica set config changes ----------------
// -------------------------------------------------------------------------------------------


db.foo.save( { _id : 5 ,x : 17 } )
assert.eq( 1 , db.foo.count() );

s.config.databases.find().forEach( printjson )
s.config.shards.find().forEach( printjson )

serverName = s.getServerName( "test" ) 

function countNodes(){
    var x = s.config.shards.findOne( { _id : serverName } );
    return x.host.split( "," ).length
}

assert.eq( 3 , countNodes() , "A1" )

rs = s.getRSEntry( serverName );
rs.test.add()
try {
    rs.test.reInitiate();
}
catch ( e ){
    // this os ok as rs's may close connections on a change of master
    print( e );
}

assert.soon( 
    function(){
        try {
            printjson( rs.test.getMaster().getDB("admin").runCommand( "isMaster" ) )
            s.config.shards.find().forEach( printjsononeline );
            return countNodes() == 4;
        }
        catch ( e ){
            print( e );
        }
    } , "waiting for config server to update" , 180 * 1000 , 1000 );

// cleanup after adding node
for ( i=0; i<5; i++ ){
    try {
        db.foo.findOne();
    }
    catch ( e ){}
}

// -------------------------------------------------------------------------------------------
// ---------- test routing to slaves ----------------
// -------------------------------------------------------------------------------------------

// --- not sharded ----

m = new Mongo( s.s.name );
ts = m.getDB( "test" ).foo

before = rs.test.getMaster().adminCommand( "serverStatus" ).opcounters

for ( i=0; i<10; i++ )
    assert.eq( 17 , ts.findOne().x , "B1" )

m.setSlaveOk()
for ( i=0; i<10; i++ )
    assert.eq( 17 , ts.findOne().x , "B2" )

after = rs.test.getMaster().adminCommand( "serverStatus" ).opcounters

printjson( before )
printjson( after )

assert.eq( before.query + 10 , after.query , "B3" )

// --- sharded ----

db.foo.ensureIndex( { x : 1 } )

for ( i=0; i<100; i++ ){
    if ( i == 17 ) continue;
    db.foo.insert( { x : i } )
}

assert.eq( 100 , db.foo.count() , "C1" )

s.adminCommand( { enablesharding : "test" } );
s.adminCommand( { shardcollection : "test.foo" , key : { x : 1 } } );

assert.eq( 100 , t.count() , "C2" )
s.adminCommand( { split : "test.foo" , middle : { x : 50 } } )

db.printShardingStatus()

other = s.config.shards.findOne( { _id : { $ne : serverName } } );
s.adminCommand( { moveChunk : "test.foo" , find : { x : 10 } , to : other._id } )
assert.eq( 100 , t.count() , "C3" )

assert.eq( 50 , rs.test.getMaster().getDB( "test" ).foo.count() , "C4" )

// by non-shard key

m = new Mongo( s.s.name );
ts = m.getDB( "test" ).foo

before = rs.test.getMaster().adminCommand( "serverStatus" ).opcounters

for ( i=0; i<10; i++ )
    assert.eq( 17 , ts.findOne( { _id : 5 } ).x , "D1" )

m.setSlaveOk()
for ( i=0; i<10; i++ )
    assert.eq( 17 , ts.findOne( { _id : 5 } ).x , "D2" )

after = rs.test.getMaster().adminCommand( "serverStatus" ).opcounters

assert.eq( before.query + 10 , after.query , "D3" )

// by shard key

m = new Mongo( s.s.name );
ts = m.getDB( "test" ).foo

before = rs.test.getMaster().adminCommand( "serverStatus" ).opcounters

for ( i=0; i<10; i++ )
    assert.eq( 57 , ts.findOne( { x : 57 } ).x , "E1" )

m.setSlaveOk()
for ( i=0; i<10; i++ )
    assert.eq( 57 , ts.findOne( { x : 57 } ).x , "E2" )

after = rs.test.getMaster().adminCommand( "serverStatus" ).opcounters

assert.eq( before.query + 10 , after.query , "E3" )



s.stop()
