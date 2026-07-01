var fso = new ActiveXObject("Scripting.FileSystemObject");
var f = fso.OpenTextFile("C:\\Users\\yooshin\\.gemini\\antigravity\\brain\\de89f8c0-a9f9-489c-9305-03f33d55182e\\.system_generated\\steps\\890\\content.md", 1);
var content = f.ReadAll();
f.Close();

var jsonStr = content.split("---")[1].replace(/^\s+|\s+$/g, "");
var obj = eval("(" + jsonStr + ")");

if (obj.response && obj.response.result) {
    var features = obj.response.result.featureCollection.features;
    for(var i=0; i<features.length; i++) {
        var props = features[i].properties;
        var msg = "";
        for(var k in props) { msg += k + ":" + props[k] + " "; }
        WScript.Echo("Feature " + i + ": " + msg);
    }
}
