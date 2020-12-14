var ctx = {
    w: 700,
    h: 550,
    active: d3.select(null),
    regions: { "MAX": { "population": 0, "density": 0, "area": 0, "shop": 0, "shop_density": 0 }, "MIN": { "population": 1000000, "density": 1000000, "area": 1000000, "shop": 10000000, "shop_density": 10000000 } },
    departments: { "MAX": { "population": 0, "density": 0, "area": 0, "shop": 0, "shop_density": 0 }, "MIN": { "population": 1000000, "density": 1000000, "area": 1000000, "shop": 10000000, "shop_density": 10000000 } },
    france_population: 0,
    france_incidence: {},
    france_cases: {},
    zoom_deps_mode: false,
    regions_geojson: null,
    departments_geojson: null,
    incidence_limits: {
        "regions": [100000, 0],
        "deps": [100000, 0]
    },
    mix_visualization: false,
    scales: {},
    current_scales: null,
    current_scale: null,
    last_scale: null,
    circle_pack_simulation: null
};

const monthMap = {
    "01": "Janvier",
    "02": "Février",
    "03": "Mars",
    "04": "Avril",
    "05": "Mai",
    "06": "Juin",
    "07": "Juillet",
    "08": "Août",
    "09": "Septembre",
    "10": "Octobre",
    "11": "Novembre",
    "12": "Décembre"
}

const path = d3.geoPath();

const projection = d3.geoConicConformal() // Lambert-93
    .center([2.454071, 46.279229]) // Center on France
    .scale(2600)
    .translate([ctx.w / 2 - 50, ctx.h / 2]);

path.projection(projection);

var createViz = function () {

    const svg = d3.select('#main').append("svg")
        .attr("id", "svg")
        .attr("width", ctx.w + 300)
        .attr("height", ctx.h)
        .on("click", function (event, d) {
            if (event.defaultPrevented) event.stopPropagation();
        }, true);

    svg.append("rect")
        .attr("class", "background")
        .attr("width", ctx.w)
        .attr("height", ctx.h)
        .on("click", reset);

    const main_map = svg.append("g")
        .attr("id", "main_map")
    const deps_map = svg.append("g")
        .attr("id", "deps_map")
        .attr("class", "Greens");

    var legend_box = d3.select("#svg").append('g')
        .attr('transform', 'translate(' + (ctx.w + 25) + ', 30)')
        .attr('id', 'legend');

    legend_box.append('g')
        .attr("id", "color_legend")
        .attr('transform', 'translate(0, 150)')
        .selectAll('.colorbar')
        .data(d3.range(9))
        .enter().append('svg:rect')
        .attr('y', d => d * 20 + 'px')
        .attr('height', '20px')
        .attr('width', '20px')
        .attr('x', '0px')
        .attr("class", d => "q" + d + "-9");

    var legendAxis = legend_box
        .append("g")
        .attr('id', 'axis_legend')
        .attr('transform', 'translate(25, 150)');

    var legendText = legend_box
        .append("text")
        .attr('id', 'text_legend')
        .attr("x", 0)
        .attr("y", 150 + 10 * 20);

    var promises = [];
    promises.push(d3.json('geojson/regions.geojson'));
    promises.push(d3.json('geojson/departements.geojson'));
    promises.push(d3.dsv(";", "csv/daily/dep.csv"));
    promises.push(d3.dsv(";", "csv/daily/reg.csv"));
    promises.push(d3.dsv(";", "csv/daily/fra.csv"));
    promises.push(d3.csv("csv/population.csv"));
    promises.push(d3.csv("csv/commerces_process.csv"));

    Promise.all(promises).then(function (values) {
        ctx.regions_geojson = values[0];
        ctx.departments_geojson = values[1];

        ProcessPopulationDatas(values[2], values[3], values[4], values[5], values[6]);

        ctx.regions_geojson.features.forEach(function (d) {
            ctx.regions[d.properties.code]["center"] = path.centroid(d);
            ctx.regions[d.properties.code]["name"] = d.properties.nom;
        });

        ctx.departments_geojson.features.forEach(function (d) {
            ctx.departments[d.properties.code]["center"] = path.centroid(d);
            ctx.departments[d.properties.code]["name"] = d.properties.nom;
        });

        PopulateSVG();

        createHeatmap([]);
        createBarChart([]);
    });

    d3.select("#scale_choice")
        .on("change", function (event, d) {
            PopulateSVG();
        });

    d3.select("#display_choice")
        .on("change", function (event, d) {
            display = d3.select(this).property('value');
            if (display == "population") {
                d3.select("#period_incidence_rate")
                    .attr("style", "visibility: hidden");
            }
            else {
                d3.select("#period_incidence_rate")
                    .attr("style", "visibility: visible");
            }

            PopulateSVG();
        });

    d3.select("#period_incidence_rate")
        .attr("style", "visibility: hidden");
    d3.select("#daily_incidence")
        .attr("style", "display: inline-block; visibility: hidden");

    d3.select("#period_incidence")
        .on("change", function (event, d) {
            period = d3.select(this).property('value');

            if (period == "daily") {
                d3.select("#daily_incidence")
                    .attr("style", "display: inline-block; visibility: visible");
            }
            else {
                d3.select("#daily_incidence")
                    .attr("style", "display: inline-block; visibility: hidden");
            }


            PopulateSVG();
        });

    d3.select("#month")
        .on("change", function (event, d) {

            d3.select("#day")
                .selectAll("option")
                .remove();

            days = [];
            for (var day in ctx.departments["01"]["incidence"][2020][d3.select("#month").property('value')]) {
                days.push(day);
            }
            days.sort();
            d3.select("#day")
                .selectAll("option")
                .data(days)
                .enter()
                .append('option')
                .attr("value", (d) => d)
                .text((d) => d);
            PopulateSVG();
        });


    d3.select("#day")
        .on("change", function (event, d) {
            PopulateSVG();
        });
};

var ProcessPopulationDatas = function (dep, reg, fra, pop_datas, shop_datas) {
    pop_datas.forEach(function (d) {
        if (d.CODE == "") { return; }
        if (!(d.CODE in ctx.departments)) {
            ctx.departments[d.CODE] = {
                "population": d.POPULATION,
                "area": d.SUPERFICIE,
                "density": d.DENSITE,
                "incidence": {},
                "positives_case": {},
                "name": d.DEPARTEMENT,
                "shop": 0
            };

            ctx.departments["MIN"]["population"] = Math.min(ctx.departments[d.CODE].population, ctx.departments["MIN"]["population"]);
            ctx.departments["MAX"]["population"] = Math.max(ctx.departments[d.CODE].population, ctx.departments["MAX"]["population"]);
            ctx.departments["MIN"]["area"] = Math.min(ctx.departments[d.CODE].area, ctx.departments["MIN"]["area"]);
            ctx.departments["MAX"]["area"] = Math.max(ctx.departments[d.CODE].area, ctx.departments["MAX"]["area"]);
            ctx.departments["MIN"]["density"] = Math.min(ctx.departments[d.CODE].density, ctx.departments["MIN"]["density"]);
            ctx.departments["MAX"]["density"] = Math.max(ctx.departments[d.CODE].density, ctx.departments["MAX"]["density"]);

            if (!(d.REGION in ctx.regions)) {
                ctx.regions[d.REGION] = {
                    "population": 0,
                    "area": 0,
                    "density": 0,
                    "incidence": {},
                    "positives_case": {},
                    "shop": 0
                };
            }

            ctx.regions[d.REGION].population += parseInt(d.POPULATION)
            ctx.regions[d.REGION].area += parseInt(d.SUPERFICIE)

            ctx.regions["MIN"]["population"] = Math.min(ctx.regions[d.REGION].population, ctx.regions["MIN"]["population"]);
            ctx.regions["MAX"]["population"] = Math.max(ctx.regions[d.REGION].population, ctx.regions["MAX"]["population"]);
            ctx.regions["MIN"]["area"] = Math.min(ctx.regions[d.REGION].area, ctx.regions["MIN"]["area"]);
            ctx.regions["MAX"]["area"] = Math.max(ctx.regions[d.REGION].area, ctx.regions["MAX"]["area"]);
        }
    });

    shop_datas.forEach(function (d) {
        if (d.DEP < 10) { d.DEP = pad(d.DEP); }
        if (!(d.DEP in ctx.departments)) { return; }
        if (!(d.REG in ctx.regions)) { return; }


        ctx.departments[d.DEP]["shop"] += parseInt(d.total);
        ctx.departments[d.DEP]["shop_density"] = parseInt(d.total) / parseInt(ctx.departments[d.DEP]["population"]) * 10000;

        ctx.departments["MIN"]["shop"] = Math.min(ctx.departments[d.DEP]["shop"], ctx.departments["MIN"]["shop"]);
        ctx.departments["MAX"]["shop"] = Math.max(ctx.departments[d.DEP]["shop"], ctx.departments["MAX"]["shop"]);

        ctx.departments["MIN"]["shop_density"] = Math.min(ctx.departments[d.DEP]["shop_density"], ctx.departments["MIN"]["shop_density"]);
        ctx.departments["MAX"]["shop_density"] = Math.max(ctx.departments[d.DEP]["shop_density"], ctx.departments["MAX"]["shop_density"]);

        ctx.regions[d.REG]["shop"] += parseInt(d.total);

        ctx.regions["MIN"]["shop"] = Math.min(ctx.regions[d.REG]["shop"], ctx.regions["MIN"]["shop"]);
        ctx.regions["MAX"]["shop"] = Math.max(ctx.regions[d.REG]["shop"], ctx.regions["MAX"]["shop"]);
    });

    for (region in ctx.regions) {
        if (region == "MIN" || region == "MAX") { continue; }
        ctx.regions[region]["density"] = parseInt(ctx.regions[region]["population"]) / parseInt(ctx.regions[region]["area"]);
        ctx.regions[region]["shop_density"] = parseInt(ctx.regions[region]["shop"]) / parseInt(ctx.regions[region]["population"]) * 10000;

        ctx.regions["MIN"]["density"] = Math.min(ctx.regions[region]["density"], ctx.regions["MIN"]["density"]);
        ctx.regions["MAX"]["density"] = Math.max(ctx.regions[region]["density"], ctx.regions["MAX"]["density"]);

        ctx.regions["MIN"]["shop_density"] = Math.min(ctx.regions[region]["shop_density"], ctx.regions["MIN"]["shop_density"]);
        ctx.regions["MAX"]["shop_density"] = Math.max(ctx.regions[region]["shop_density"], ctx.regions["MAX"]["shop_density"]);
    }

    month_meet = new Set();

    dep.forEach(function (d) {
        if (!(d.dep in ctx.departments)) { return; }


        date = d.jour.split('-');
        day = date[2], month = date[1], year = date[0];

        if (!(year in ctx.departments[d.dep]["incidence"])) { ctx.departments[d.dep]["incidence"][year] = {}; ctx.departments[d.dep]["positives_case"][year] = {}; }
        if (!(month in ctx.departments[d.dep]["incidence"][year])) { ctx.departments[d.dep]["incidence"][year][month] = {}; ctx.departments[d.dep]["positives_case"][year][month] = {}; }

        if (!month_meet.has(month)) {
            month_meet.add(month);

            d3.select("#month")
                .append('option')
                .attr("value", month)
                .text(monthMap[month]);
        }

        incidence = d.P * 100000 / ctx.departments[d.dep].population;
        ctx.departments[d.dep]["incidence"][year][month][day] = incidence;
        ctx.departments[d.dep]["positives_case"][year][month][day] = d.P;

        ctx.incidence_limits["deps"][0] = Math.min(ctx.incidence_limits["deps"][0], incidence);
        ctx.incidence_limits["deps"][1] = Math.min(1000, Math.max(ctx.incidence_limits["deps"][1], incidence));
    });

    reg.forEach(function (d) {
        if (!(d.reg in ctx.regions)) { return; }

        date = d.jour.split('-');
        day = date[2], month = date[1], year = date[0];

        if (!(year in ctx.regions[d.reg]["incidence"])) { ctx.regions[d.reg]["incidence"][year] = {}; ctx.regions[d.reg]["positives_case"][year] = {}; }
        if (!(month in ctx.regions[d.reg]["incidence"][year])) { ctx.regions[d.reg]["incidence"][year][month] = {}; ctx.regions[d.reg]["positives_case"][year][month] = {}; }

        incidence = d.P * 100000 / ctx.regions[d.reg].population;
        ctx.regions[d.reg]["incidence"][year][month][day] = incidence;
        ctx.regions[d.reg]["positives_case"][year][month][day] = d.P;

        ctx.incidence_limits["regions"][0] = Math.min(ctx.incidence_limits["regions"][0], incidence);
        ctx.incidence_limits["regions"][1] = Math.min(1000, Math.max(ctx.incidence_limits["regions"][1], incidence));
    });

    fra.forEach(function (d) {
        if (ctx.france_population == 0) { ctx.france_population = d.pop; }

        if (!(year in ctx.france_incidence)) { ctx.france_incidence[year] = {}; ctx.france_cases[year] = {}; }
        if (!(month in ctx.france_incidence[year])) { ctx.france_incidence[year][month] = {}; ctx.france_cases[year][month] = {}; }

        incidence = d.P * 100000 / d.pop;
        ctx.france_incidence[year][month][day] = incidence;
        ctx.france_cases[year][month][day] = d.P;
    });

    CreateAllScales();
};
var CreateAllScales = function () {
    ctx.scales["population"] = {};
    ctx.scales["population"]["dept"] = {
        "data": ctx.departments,
        "scale": d3.scaleQuantize()
            .domain([ctx.departments["MIN"]["population"], ctx.departments["MAX"]["population"]])
            .range(d3.range(9)),
        "color": "Greens",
        "text": "Population",
        "feature": "population"
    };
    ctx.scales["population"]["reg"] = {
        "data": ctx.regions,
        "scale": d3.scaleQuantize()
            .domain([ctx.regions["MIN"]["population"], ctx.regions["MAX"]["population"]])
            .range(d3.range(9)),
        "color": "Blues",
        "text": "Population",
        "feature": "population"
    };

    ctx.scales["density"] = {};
    ctx.scales["density"]["dept"] = {
        "data": ctx.departments,
        "scale": d3.scaleQuantize()
            .domain([ctx.departments["MIN"]["density"], ctx.departments["MAX"]["density"]])
            .range(d3.range(9)),
        "color": "Greens",
        "text": "Densité (hab/km²)",
        "feature": "density"
    };
    ctx.scales["density"]["reg"] = {
        "data": ctx.regions,
        "scale": d3.scaleQuantize()
            .domain([ctx.regions["MIN"]["density"], ctx.regions["MAX"]["density"]])
            .range(d3.range(9)),
        "color": "Blues",
        "text": "Densité (hab/km²)",
        "feature": "density"
    };

    ctx.scales["shop"] = {};
    ctx.scales["shop"]["dept"] = {
        "data": ctx.departments,
        "scale": d3.scaleQuantize()
            .domain([ctx.departments["MIN"]["shop"], ctx.departments["MAX"]["shop"]])
            .range(d3.range(9)),
        "color": "Greens",
        "text": "Commerces",
        "feature": "shop"
    };
    ctx.scales["shop"]["reg"] = {
        "data": ctx.regions,
        "scale": d3.scaleQuantize()
            .domain([ctx.regions["MIN"]["shop"], ctx.regions["MAX"]["shop"]])
            .range(d3.range(9)),
        "color": "Blues",
        "text": "Commerces",
        "feature": "shop"
    };

    ctx.scales["shop_density"] = {};
    ctx.scales["shop_density"]["dept"] = {
        "data": ctx.departments,
        "scale": d3.scaleQuantize()
            .domain([ctx.departments["MIN"]["shop_density"], ctx.departments["MAX"]["shop_density"]])
            .range(d3.range(9)),
        "color": "Greens",
        "text": "Densité de commerces (/10000 hab)",
        "feature": "shop_density"
    };
    ctx.scales["shop_density"]["reg"] = {
        "data": ctx.regions,
        "scale": d3.scaleQuantize()
            .domain([ctx.regions["MIN"]["shop_density"], ctx.regions["MAX"]["shop_density"]])
            .range(d3.range(9)),
        "color": "Blues",
        "text": "Densité de commercces(/10000 hab)",
        "feature": "shop_density"
    };

    ctx.scales["incidence"] = {};
    ctx.scales["incidence"]["dept"] = {
        "data": ctx.departments,
        "scale": d3.scaleQuantize()
            .domain([ctx.incidence_limits["deps"][0], ctx.incidence_limits["deps"][1]])
            .range(d3.range(9)),
        "color": "Reds",
        "text": "Taux d'incidence (pour 100 000 habitants)",
        "feature": "incidence"
    };
    ctx.scales["incidence"]["reg"] = {
        "data": ctx.regions,
        "scale": d3.scaleQuantize()
            .domain([ctx.incidence_limits["regions"][0], ctx.incidence_limits["regions"][1]])
            .range(d3.range(9)),
        "color": "Reds",
        "text": "Taux d'incidence (pour 100 000 habitants)",
        "feature": "incidence"
    };

    ctx.scales["incidence_daily"] = {};
    ctx.scales["incidence_daily"]["dept"] = {
        "data": ctx.departments,
        "scale": d3.scaleQuantize()
            .domain([ctx.incidence_limits["deps"][0], 1300])
            .range(d3.range(9)),
        "color": "Reds",
        "text": "Taux d'incidence (pour 100 000 habitants) 7 derniers jours",
        "feature": "incidence"
    };
    ctx.scales["incidence_daily"]["reg"] = {
        "data": ctx.regions,
        "scale": d3.scaleQuantize()
            .domain([ctx.incidence_limits["regions"][0], 1300])
            .range(d3.range(9)),
        "color": "Reds",
        "text": "Taux d'incidence (pour 100 000 habitants) 7 derniers jours",
        "feature": "incidence"
    };
};

function CreateCorrelateVisualization(aggregation_variable) {
    ctx.current_scale = ctx.scales[aggregation_variable];
    switch (d3.select("#period_incidence").property('value')) {
        case "daily":
            incidence_scale = ctx.scales["incidence_daily"];
            break;
        case "monthly":
            incidence_scale = ctx.scales["incidence"];
            break;
    }

    if (ctx.circle_pack_simulation != null) {
        ctx.circle_pack_simulation.stop();
    }

    var div = d3.select(".tooltip");

    d3.select('#main_map').selectAll("*").remove();
    d3.select('#deps_map').selectAll("*").remove();

    d3.select("#main_map")
        .attr("class", incidence_scale[zoom_area()].color)
        .selectAll("path")
        .data(ctx.regions_geojson.features)
        .enter()
        .append("path")
        .classed("feature", true)
        .classed("region", true)
        .attr("d", path)

    var dlist = Object.entries(ctx.current_scale[zoom_area()].data);
    d3.select("#main_map")
        .selectAll("circle")
        .data(dlist)
        .enter()
        .append("circle")
        .attr("cx", function (d) { if (d[0] == "MAX" || d[0] == "MIN") { return; } return d[1].center[0] })
        .attr("cy", function (d) { if (d[0] == "MAX" || d[0] == "MIN") { return; } return d[1].center[1] })
        .attr("stroke-width", 3)
        .attr("stroke", "black")
        .attr("fill-opacity", .8);

    if (!ctx.mix_visualization) {
        d3.select("#main_map")
            .selectAll("circle")
            .attr("r", 0)
            .transition()
            .duration(1000)
            .attr("r", function (d) { if (d[0] == "MAX" || d[0] == "MIN") { return 0; } return ctx.current_scale["reg"].scale(d[1][aggregation_variable]) * 5 + 15; });
    }
    else {
        d3.select("#main_map")
            .selectAll("circle")
            .attr("r", function (d) { if (d[0] == "MAX" || d[0] == "MIN") { return 0; } return ctx.current_scale["reg"].scale(d[1][aggregation_variable]) * 5 + 15; });
    }

    month = d3.select("#month").property('value');
    day = d3.select("#day").property('value');

    switch (d3.select("#period_incidence").property('value')) {
        case "daily":
            d3.select("#main_map")
                .selectAll("circle")
                .attr("class", function (d) { if (d[0] == "MAX" || d[0] == "MIN") { return; } return d3.select(this).attr("class") + " " + "q" + incidence_scale[zoom_area()].scale(get_last_seven_days(incidence_scale[zoom_area()].data[d[0]]["incidence"], year, month, day)) + "-9"; })
                .on("mouseover", function (event, d) {
                    if (d3.select(this).attr("opacity") == 0) { return; }
                    div.transition()
                        .duration(200)
                        .style("opacity", .9);
                    div.html(d[1].name + "<br/>"
                        + "Population : " + formatNumber(d[1].population) + "<br/>"
                        + "Densité : " + formatNumber(d[1].density) + "<br/>"
                        + "Commerces : " + formatNumber(d[1].shop) + "<br/>"
                        + "Densité de commerces: " + formatNumber(d[1].shop_density) + "<br/>"
                        + "Taux d'incidence : " + get_last_seven_days(incidence_scale[zoom_area()].data[d[0]]["incidence"], year, month, day).toFixed(2))
                        .style("left", (event.pageX + 10) + "px")
                        .style("top", (event.pageY - 10) + "px")
                })
                .on("mouseout", function (event, d) {
                    div.style("opacity", 0);
                    div.html("")
                        .style("left", "-500px")
                        .style("top", "-500px");
                });
            break;
        case "monthly":
            d3.select("#main_map")
                .selectAll("circle")
                .attr("class", function (d) { if (d[0] == "MAX" || d[0] == "MIN") { return; } return d3.select(this).attr("class") + " " + "q" + incidence_scale[zoom_area()].scale(avg(incidence_scale[zoom_area()].data[d[0]]["incidence"][2020][month])) + "-9"; })
                .on("mouseover", function (event, d) {
                    if (d3.select(this).attr("opacity") == 0) { return; }
                    div.transition()
                        .duration(200)
                        .style("opacity", .9);
                    div.html(d[1].name + "<br/>"
                        + "Population : " + formatNumber(d[1].population) + "<br/>"
                        + "Densité : " + formatNumber(d[1].density) + "<br/>"
                        + "Commerces : " + formatNumber(d[1].shop) + "<br/>"
                        + "Densité de commerces: " + formatNumber(d[1].shop_density) + "<br/>"
                        + "Taux d'incidence : " + avg(incidence_scale[zoom_area()].data[d[0]]["incidence"][2020][month]).toFixed(2))
                        .style("left", (event.pageX + 10) + "px")
                        .style("top", (event.pageY - 10) + "px")
                })
                .on("mouseout", function (event, d) {
                    div.style("opacity", 0);
                    div.html("")
                        .style("left", "-500px")
                        .style("top", "-500px");
                });
            break;
    }

    if (d3.select("#scale_choice").property('value') == "dept" || ctx.zoom_deps_mode == true) {
        CleanMixLegend();
        ctx.mix_visualization = false;
        ctx.last_mix = "dept";

        d3.select("#color_legend")
            .attr('class', incidence_scale["dept"].color);

        var legendScale = d3.scaleLinear()
            .domain(incidence_scale["dept"].scale.domain())
            .range([0, 9 * 20]);

        d3.select("#axis_legend")
            .call(d3.axisRight(legendScale).ticks(6));

        d3.select("#text_legend")
            .text(incidence_scale["dept"].text);

        // Add legend: circles
        var valuesToShow = [ctx.departments["MAX"][aggregation_variable] * 0.3, ctx.departments["MAX"][aggregation_variable] * 0.7, ctx.departments["MAX"][aggregation_variable]];
    }
    else {
        CleanMixLegend();
        ctx.mix_visualization = false;
        ctx.last_mix = "reg";

        d3.select("#color_legend")
            .attr('class', incidence_scale["reg"].color);

        var legendScale = d3.scaleLinear()
            .domain(incidence_scale["reg"].scale.domain())
            .range([0, 9 * 20]);

        d3.select("#axis_legend")
            .call(d3.axisRight(legendScale).ticks(6));

        d3.select("#text_legend")
            .text(incidence_scale["reg"].text);

        // Add legend: circles
        var valuesToShow = [ctx.regions["MAX"][aggregation_variable] * 0.3, ctx.regions["MAX"][aggregation_variable] * 0.7, ctx.regions["MAX"][aggregation_variable]];
    }


    if (!ctx.mix_visualization) {
        var xCircle = 0;
        var xLabel = 100;
        var yCircle = 100;
        d3.select("#legend")
            .selectAll("legend")
            .data(valuesToShow)
            .enter()
            .append("circle")
            .attr("class", "circle_mix_legend")
            .attr("cx", xCircle)
            .attr("cy", function (d) { return yCircle - (ctx.current_scale[ctx.last_mix].scale(d) * 5 + 15) })
            .style("fill", "none")
            .attr("stroke", "black");

        d3.select("#legend")
            .selectAll("circle")
            .transition()
            .duration(300)
            .attr("r", function (d) { return (ctx.current_scale[ctx.last_mix].scale(d) * 5 + 15) });

        // Add legend: segments
        d3.select("#legend")
            .selectAll("legend")
            .data(valuesToShow)
            .enter()
            .append("line")
            .attr("class", "line_mix_legend")
            .attr('x1', function (d) { return xCircle + (ctx.current_scale[ctx.last_mix].scale(d) * 5 + 15) })
            .attr('x2', xLabel)
            .attr('y1', function (d) { return yCircle - (ctx.current_scale[ctx.last_mix].scale(d) * 5 + 15) })
            .attr('y2', function (d) { return yCircle - (ctx.current_scale[ctx.last_mix].scale(d) * 5 + 15) })
            .attr('stroke', 'black')
            .style('stroke-dasharray', ('2,2'))

        // Add legend: labels
        d3.select("#legend")
            .selectAll("legend")
            .data(valuesToShow)
            .enter()
            .append("text")
            .attr("class", "text_mix_legend")
            .attr('x', xLabel + 5)
            .attr('y', function (d) { return yCircle - (ctx.current_scale[ctx.last_mix].scale(d) * 5 + 15) })
            .text(function (d) {
                if (d > 1000000) { return formatNumber(roundMillion(d)); }
                else return parseInt(d);
            })
            .style("font-size", 12)
            .attr('alignment-baseline', 'middle')

        console.log(ctx.current_scale);

        d3.select("#legend")
            .append("text")
            .attr("class", "text_mix_legend")
            .attr('x', -30)
            .attr('y', -20)
            .text(ctx.current_scale[zoom_area()].text)
            .style("font-size", 12)
            .attr('alignment-baseline', 'middle')

    }

    ctx.intervalId = setInterval(SimulationNode, 1500, dlist, aggregation_variable);

    ctx.mix_visualization = true;
}

var SimulationNode = function (dlist, aggregation_variable) {
    clearInterval(ctx.intervalId);

    d3.select("#main_map")
        .selectAll("path")
        .transition()
        .duration(200)
        .attr("opacity", 0);

    ctx.circle_pack_simulation = d3.forceSimulation()
        .force("center", d3.forceCenter().x(ctx.w / 2).y(ctx.h / 2)) // Attraction to the center of the svg area
        .force("charge", d3.forceManyBody().strength(.9)) // Nodes are attracted one each other of value is > 0
        .force("collide", d3.forceCollide().strength(0.5).radius(function (d) { return ((ctx.current_scale["reg"].scale(d[1][aggregation_variable]) * 5 + 15) + 1) }).iterations(1)) // Force that avoids circle overlapping

    // Apply these forces to the nodes and update their positions.
    // Once the force algorithm is happy with positions ('alpha' value is low enough), simulations will stop.
    var duration = 500;
    ctx.circle_pack_simulation
        .nodes(dlist)
        .on("tick", function (d) {
            if (duration > 0) { duration -= 10; }
            d3.select("#main_map")
                .selectAll("circle")
                .transition()
                .duration(duration)
                .attr("cx", function (d) { return d.x; })
                .attr("cy", function (d) { return d.y; })
        });
};

function PopulateSVG() {

    d3.select('#main_map').selectAll("*").remove();
    d3.select('#deps_map').selectAll("*").remove();

    if (d3.select("#display_choice").property('value').substring(0, 3) == "mix") {

        d3.select("#legend")
            .selectAll(".text_mix_legend")
            .transition()
            .duration(300)
            .attr("opacity", 1);

        d3.select("#legend")
            .selectAll(".line_mix_legend")
            .transition()
            .duration(300)
            .attr("opacity", 1);

        CreateCorrelateVisualization(d3.select("#display_choice").property('value').substring(4));
        return;
    }

    if (ctx.mix_visualization == true) {
        ctx.mix_visualization = false;
        ctx.circle_pack_simulation.stop();

        d3.select("#main_map")
            .transition()
            .duration(500)
            .attr("opacity", 1);


        CleanMixLegend();

    }

    switch (d3.select("#scale_choice").property('value')) {
        case "reg":
            d3.select("#main_map")
                .selectAll("path")
                .data(ctx.regions_geojson.features)
                .enter()
                .append("path")
                .classed("feature", true)
                .classed("region", true)
                .attr("d", path);
            break;
        case "dept":
            d3.select("#main_map")
                .selectAll("path")
                .data(ctx.departments_geojson.features)
                .enter()
                .append("path")
                .classed("feature", true)
                .classed("region", true)
                .attr("d", path);
            break;
    }

    UpdateDisplayVariable();
    UpdateLegend();
}

function UpdateDisplayVariable() {
    var div = d3.select("body").append("div")
        .attr("class", "tooltip")
        .style("opacity", 0);

    switch (d3.select("#display_choice").property('value')) {
        case "population":
        case "density":
            ctx.current_scales = ctx.scales[d3.select("#display_choice").property('value')];
            ctx.current_scale = ctx.current_scales[zoom_area()];

            d3.select("#main_map")
                .selectAll("path")
                .attr("class", function (d) { return d3.select(this).attr("class") + " " + "q" + ctx.current_scale.scale(ctx.current_scale.data[d.properties.code][ctx.current_scale.feature]) + "-9"; })
                .on("mouseover", function (event, d) {
                    if (d3.select(this).attr("opacity") == 0) { return; }
                    div.transition()
                        .duration(200)
                        .style("opacity", .9);
                    div.html(d.properties.nom + "<br/>"
                        + "Population : " + formatNumber(ctx.current_scale.data[d.properties.code].population) + "<br/>"
                        + "Densité : " + formatNumber(ctx.current_scale.data[d.properties.code].density) + " hab/km²")
                        .style("left", (event.pageX + 10) + "px")
                        .style("top", (event.pageY - 10) + "px")
                })
                .on("mouseout", function (event, d) {
                    div.style("opacity", 0);
                    div.html("")
                        .style("left", "-500px")
                        .style("top", "-500px");
                });
            if (d3.select("#scale_choice").property('value') == "reg") {
                d3.select("#main_map")
                    .selectAll("path")
                    .on("click", function (event, d) {
                        if (ctx.active.node() === this || ctx.active.node() != null) return reset();
                        ctx.active.classed("active", false);
                        ctx.active = d3.select(this).classed("active", true);

                        PopulateRegionDepartments(d.properties.code);

                        d3.select("#main_map").selectAll("path")
                            .transition()
                            .duration(300)
                            .attr("opacity", (e) => e.properties.code == d.properties.code ? 1 : 0);

                        d3.select('#legend').attr("opacity", 0);

                        var bounds = path.bounds(d),
                            dx = bounds[1][0] - bounds[0][0],
                            dy = bounds[1][1] - bounds[0][1],
                            x = (bounds[0][0] + bounds[1][0]) / 2,
                            y = (bounds[0][1] + bounds[1][1]) / 2,
                            scale = Math.max(1, Math.min(8, 0.9 / Math.max(dx / ctx.w, dy / ctx.h))),
                            translate = [ctx.w / 2 - scale * x, ctx.h / 2 - scale * y];

                        d3.select("#svg").transition()
                            .duration(750)
                            .call(zoom.transform, d3.zoomIdentity.translate(translate[0], translate[1]).scale(scale)); // updated for d3 v6

                        ctx.zoom_deps_mode = true;
                        UpdateLegend();
                    });
            }
            break;
        case "incidence_rate":
            d3.select("#period_incidence_rate")
                .attr("style", "visibility: visible");

            month = d3.select("#month").property('value');
            day = d3.select("#day").property('value');

            switch (d3.select("#period_incidence").property('value')) {
                case "daily":
                    ctx.current_scales = ctx.scales["incidence_daily"];
                    ctx.current_scale = ctx.current_scales[zoom_area()];

                    d3.select("#main_map")
                        .selectAll("path")
                        .attr("class", function (d) { return d3.select(this).attr("class") + " " + "q" + ctx.current_scale.scale(get_last_seven_days(ctx.current_scale.data[d.properties.code][ctx.current_scale.feature], year, month, day)) + "-9"; })
                        .on("mouseover", function (event, d) {
                            if (d3.select(this).attr("opacity") == 0) { return; }
                            div.transition()
                                .duration(200)
                                .style("opacity", .9);
                            div.html(d.properties.nom + "<br/>"
                                + "Taux d'incidence : " + get_last_seven_days(ctx.current_scale.data[d.properties.code][ctx.current_scale.feature], year, month, day).toFixed(2))
                                .style("left", (event.pageX + 10) + "px")
                                .style("top", (event.pageY - 10) + "px")
                        })
                        .on("mouseout", function (event, d) {
                            div.style("opacity", 0);
                            div.html("")
                                .style("left", "-500px")
                                .style("top", "-500px");
                        });
                    break;
                case "monthly":
                    ctx.current_scales = ctx.scales["incidence"];
                    ctx.current_scale = ctx.current_scales[zoom_area()];

                    d3.select("#main_map")
                        .selectAll("path")
                        .attr("class", function (d) { return d3.select(this).attr("class") + " " + "q" + ctx.current_scale.scale(avg(ctx.current_scale.data[d.properties.code][ctx.current_scale.feature][2020][month])) + "-9"; })
                        .on("mouseover", function (event, d) {
                            if (d3.select(this).attr("opacity") == 0) { return; }
                            div.transition()
                                .duration(200)
                                .style("opacity", .9);
                            div.html(d.properties.nom + "<br/>"
                                + "Taux d'incidence : " + avg(ctx.current_scale.data[d.properties.code][ctx.current_scale.feature][2020][month]).toFixed(2))
                                .style("left", (event.pageX + 10) + "px")
                                .style("top", (event.pageY - 10) + "px")
                        })
                        .on("mouseout", function (event, d) {
                            div.style("opacity", 0);
                            div.html("")
                                .style("left", "-500px")
                                .style("top", "-500px");
                        });
                    break;
            }

            if (d3.select("#scale_choice").property('value') == "reg") {
                d3.select("#main_map")
                    .selectAll("path")
                    .on("click", function (event, d) {
                        if (ctx.active.node() === this || ctx.active.node() != null) return reset();
                        ctx.active.classed("active", false);
                        ctx.active = d3.select(this).classed("active", true);

                        PopulateRegionDepartments(d.properties.code);

                        d3.select("#main_map").selectAll("path")
                            .transition()
                            .duration(300)
                            .attr("opacity", (e) => e.properties.code == d.properties.code ? 1 : 0);

                        d3.select('#legend').attr("opacity", 0);

                        var bounds = path.bounds(d),
                            dx = bounds[1][0] - bounds[0][0],
                            dy = bounds[1][1] - bounds[0][1],
                            x = (bounds[0][0] + bounds[1][0]) / 2,
                            y = (bounds[0][1] + bounds[1][1]) / 2,
                            scale = Math.max(1, Math.min(8, 0.9 / Math.max(dx / ctx.w, dy / ctx.h))),
                            translate = [ctx.w / 2 - scale * x, ctx.h / 2 - scale * y];

                        d3.select("#svg").transition()
                            .duration(750)
                            .call(zoom.transform, d3.zoomIdentity.translate(translate[0], translate[1]).scale(scale)); // updated for d3 v6

                        ctx.zoom_deps_mode = true;
                        UpdateLegend();
                    });
            }
            break;
    }
}
var PopulateRegionDepartments = function (code) {
    var div = d3.select(".tooltip");

    ctx.last_scale = ctx.current_scale;
    ctx.current_scale = ctx.current_scales["dept"];

    codes = [];

    d3.json('geojson/regions_departments/departements-' + code + '.geojson').then(function (geojson) {
        d3.select('#deps_map')
            .attr("class", ctx.current_scale.color)
            .selectAll("path")
            .data(geojson.features)
            .enter()
            .append("path")
            .attr('id', function (d) { codes.push(d.properties.code); return d.properties.code; })
            .attr("class", "feature department")
            .attr("d", path)
            .attr("stroke-width", 0)
            .attr("opacity", 0)
            .on("click", reset)
            .transition()
            .delay(1000)
            .duration(200)
            .attr("opacity", 1)
            .attr("stroke-width", 0.5);

        switch (d3.select("#display_choice").property('value')) {
            case "population":
                d3.select('#deps_map')
                    .selectAll("path")
                    .attr("class", function (d) { return d3.select(this).attr("class") + " " + "q" + ctx.current_scale.scale(ctx.departments[d.properties.code][ctx.current_scale.feature]) + "-9"; })
                    .on("mouseover", function (event, d) {
                        if (d3.select(this).attr("opacity") == 0 || d == "undefined") { return; }
                        div.transition()
                            .duration(200)
                            .style("opacity", .9);
                        div.html(d.properties.nom + "<br/>"
                            + "Population : " + formatNumber(ctx.current_scale.data[d.properties.code].population) + "<br/>"
                            + "Densité : " + formatNumber(ctx.current_scale.data[d.properties.code].density) + " hab/km²")
                            .style("left", (event.pageX + 10) + "px")
                            .style("top", (event.pageY - 10) + "px")
                    })
                    .on("mouseout", function (event, d) {
                        div.style("opacity", 0);
                        div.html("")
                            .style("left", "-500px")
                            .style("top", "-500px");
                    });
                break;
            case "incidence_rate":
                incidence = ctx.departments_incidence;

                month = d3.select("#month").property('value');
                day = d3.select("#day").property('value');

                switch (d3.select("#period_incidence").property('value')) {
                    case "daily":
                        d3.select('#deps_map')
                            .selectAll("path")
                            .attr("class", function (d) { return d3.select(this).attr("class") + " " + "q" + ctx.current_scale.scale(ctx.current_scale.data[d.properties.code][ctx.current_scale.feature][2020][month][day]) + "-9"; })
                            .on("mouseover", function (event, d) {
                                if (d3.select(this).attr("opacity") == 0) { return; }
                                div.transition()
                                    .duration(200)
                                    .style("opacity", .9);
                                div.html(d.properties.nom + "<br/>"
                                    + "Taux d'incidence : " + ctx.current_scale.data[d.properties.code][ctx.current_scale.feature][2020][month][day].toFixed(2))
                                    .style("left", (event.pageX + 10) + "px")
                                    .style("top", (event.pageY - 10) + "px")
                            })
                            .on("mouseout", function (event, d) {
                                div.style("opacity", 0);
                                div.html("")
                                    .style("left", "-500px")
                                    .style("top", "-500px");
                            });
                        break;
                    case "monthly":
                        d3.select('#deps_map').selectAll("path")
                            .attr("class", function (d) { return d3.select(this).attr("class") + " " + "q" + ctx.current_scale.scale(avg(ctx.current_scale.data[d.properties.code][ctx.current_scale.feature][2020][month])) + "-9"; })
                            .on("mouseover", function (event, d) {
                                if (d3.select(this).attr("opacity") == 0) { return; }
                                div.transition()
                                    .duration(200)
                                    .style("opacity", .9);
                                div.html(d.properties.nom + "<br/>"
                                    + "Taux d'incidence : " + avg(ctx.current_scale.data[d.properties.code][ctx.current_scale.feature][2020][month]).toFixed(2))
                                    .style("left", (event.pageX + 10) + "px")
                                    .style("top", (event.pageY - 10) + "px")
                            })
                            .on("mouseout", function (event, d) {
                                div.style("opacity", 0);
                                div.html("")
                                    .style("left", "-500px")
                                    .style("top", "-500px");
                            });
                        break;
                }
                break;
        };


        createHeatmap(codes);
        createBarChart(codes);
    });


    d3.select('#legend')
        .transition()
        .delay(1200)
        .duration(200)
        .attr("opacity", 1);
};

function reset() {
    ctx.active.classed("active", false);
    ctx.active = d3.select(null);

    d3.select('#svg').transition()
        .delay(500)
        .duration(750)
        .call(zoom.transform, d3.zoomIdentity); // updated for d3 v6

    d3.select('#deps_map').selectAll("path")
        .transition()
        .duration(300)
        .attr("opacity", 0)
        .on("end", function () {
            d3.select('#deps_map').selectAll("*").remove();
        });


    d3.select("#main_map").selectAll("path")
        .transition()
        .duration(300)
        .attr("opacity", 1);

    ctx.zoom_deps_mode = false;
    ctx.current_scale = ctx.last_scale;
    UpdateLegend();

    d3.select('#legend')
        .attr("opacity", 0)
        .transition()
        .delay(1250)
        .duration(200)
        .attr("opacity", 1);

    createHeatmap([]);
    createBarChart([]);
}

const zoom = d3.zoom().on("zoom", zoomed);

function zoomed(event, d) {
    d3.select('#main_map').style("stroke-width", 1 / event.transform.k + "px");
    d3.select('#main_map').attr("transform", event.transform); // updated for d3 v6

    d3.select('#deps_map').style("stroke-width", 1 / event.transform.k + "px");
    d3.select('#deps_map').attr("transform", event.transform); // updated for d3 v6
}

var formatNumber = function (number) {
    return new Intl.NumberFormat().format(number);
};

function UpdateLegend() {
    d3.select("#main_map")
        .attr("class", ctx.current_scale.color)

    d3.select("#color_legend")
        .attr('class', ctx.current_scale.color);

    var legendScale = d3.scaleLinear()
        .domain(ctx.current_scale.scale.domain())
        .range([0, 9 * 20]);

    d3.select("#axis_legend")
        .call(d3.axisRight(legendScale).ticks(6));
    d3.select("#text_legend")
        .text(ctx.current_scale.text);
}

var avg = function (array) {
    var total = 0;
    var i = 0

    for (var day in array) {
        total += array[day];
        i++;
    }

    return total / i;
};
var sum = function (array) {
    var total = 0;

    for (var day in array) {
        total += parseInt(array[day]);
    }

    return total;
};
var sumoverregion = function (array) {
    var total = 0;

    for (var month in array) {
        total += sum(array[month]);
    }

    return total;
}

var get_last_seven_days = function (array, year, month, day) {
    var total = 0

    if (day >= 7) {
        for (let i = 0; i < 7; i++) {
            if (!((day - i) in array[year][month])) { break; }
            total += array[year][month][day - i]
        }
    }
    else {
        day_in_other_month = 7 - day;

        for (let i = day; i > 0; i--) {
            if (!(i in array[year][month])) { break; }
            total += array[year][month][i]
        }

        previous_month = pad(month - 1);

        for (let i = 0; i < day_in_other_month; i++) {
            if (!(previous_month in array[year])) { break; }

            choose_day = pad(Object.keys(array[year][previous_month]).length - i - 1);

            total += array[year][previous_month][choose_day];
        }
    }

    return total;
};

function pad(d) {
    return (d < 10) ? '0' + d.toString() : d.toString();
}

var roundMillion = function (value) {
    return Math.round(value / 1000000) * 1000000
}

var zoom_area = function () {
    if (d3.select("#scale_choice") == null) { return; }

    return d3.select("#scale_choice").property('value');
}

var CleanMixLegend = function () {
    d3.select("#legend")
        .selectAll("circle")
        .transition()
        .duration(300)
        .attr("r", 0);

    d3.select("#legend")
        .selectAll("circle")
        .remove();

    d3.select("#legend")
        .selectAll(".text_mix_legend")
        .transition()
        .duration(300)
        .attr("opacity", 0);

    d3.select("#legend")
        .selectAll(".text_mix_legend")
        .remove();

    d3.select("#legend")
        .selectAll(".line_mix_legend")
        .transition()
        .duration(300)
        .attr("opacity", 0);

    d3.select("#legend")
        .selectAll(".line_mix_legend")
        .remove();
};

var createBarChart = function (dept_codes) {

    reshape_data = [];
    max_value = 0;

    always_found_densities = [];

    if (dept_codes.length < 1) {
        for (region in ctx.regions) {
            if (region == "MAX" || region == "MIN") { continue; }

            cases = parseInt(sumoverregion(ctx.regions[region]["positives_case"][2020]));
            max_value = Math.max(cases, max_value);

            density = parseInt(ctx.regions[region]["density"]);
            if (always_found_densities.includes(density)) {
                density += 1
            }
            always_found_densities.push(density)

            reshape_data.push({
                "name": ctx.regions[region]["name"],
                "density": density,
                "covid_people": cases
            });
        }
        title = "Région";
    }
    else {
        dept_codes.forEach(function (dept) {

            cases = parseInt(sumoverregion(ctx.departments[dept]["positives_case"][2020]));
            max_value = Math.max(cases, max_value);

            reshape_data.push({
                "name": ctx.departments[dept]["name"],
                "density": parseInt(ctx.departments[dept]["density"]),
                "covid_people": cases
            });
        });
        title = "Département";
    }

    var vlSpec = {
        "$schema": "https://vega.github.io/schema/vega-lite/v4.json",
        "data": { "values": reshape_data },
        "width": 500,
        "height": 200,
        "mark": { "type": "bar", "cornerRadiusEnd": 2 },
        "encoding": {
            "x": {
                "field": "density",
                "axis": { "title": "Densité des " + title.toLowerCase() + " (hab/km²)" }
            },
            "y": {
                "field": "covid_people",
                "type": "quantitative",
                "axis": { "title": "Nombre de cas (depuis Mai)" }
            },
            "tooltip": [
                { "field": "name", "type": "nominal", "title": title },
                { "field": "covid_people", "type": "quantitative", "title": "Nombre de cas" }
            ],
            "color": {
                "field": "covid_people",
                "type": "quantitative",
                "legend": { "title": "Cas positifs depuis Mai" },
                "scale": {
                    "scheme": "RedYellowGreen",
                    "reverse": "true",
                    "domainMid": max_value / 2
                }
            }
        }
    }

    // see options at https://github.com/vega/vega-embed/blob/master/README.md
    var vlOpts = { width: 600, height: 300, actions: false };
    vegaEmbed("#density_chart", vlSpec, vlOpts);
};

var createHeatmap = function (dept_codes) {

    reshape_data = [];
    max_value = 0;

    if (dept_codes.length < 1) {
        for (region in ctx.regions) {
            if (region == "MAX" || region == "MIN") { continue; }

            for (month in ctx.regions[region]["positives_case"][2020]) {
                cases = parseInt(sum(ctx.regions[region]["positives_case"][2020][month]));
                max_value = Math.max(cases, max_value);

                reshape_data.push({
                    "region": ctx.regions[region]["name"],
                    "month": month,
                    "covid_people": cases
                });
            }
        }

        title = "Région";
    }
    else {
        dept_codes.forEach(function (dept) {
            for (month in ctx.departments[dept]["positives_case"][2020]) {
                cases = parseInt(sum(ctx.departments[dept]["positives_case"][2020][month]));
                max_value = Math.max(cases, max_value);

                reshape_data.push({
                    "region": ctx.departments[dept]["name"],
                    "month": month,
                    "covid_people": cases
                });
            }
        });

        title = "Département";
    }

    var vlSpec = {
        "$schema": "https://vega.github.io/schema/vega-lite/v4.json",
        "data": { "values": reshape_data },
        "width": 400,
        "height": 200,
        "mark": "rect",
        "encoding": {
            "y": {
                "field": "region", "type": "nominal",
                "axis": { "title": title }
            },
            "x": {
                "field": "month", "type": "nominal",
                "axis": { "title": "Mois" }
            },
            "color": {
                "aggregate": "sum",
                "field": "covid_people",
                "type": "quantitative",
                "legend": { "title": "Nombre de cas positifs" },
                "scale": {
                    "scheme": "RedYellowGreen",
                    "reverse": "true",
                    "domainMid": max_value / 10
                }
            },
            // "size": {
            //     "field": "covid_people",
            //     "type": "quantitative",
            //     "aggregate": "sum",
            //     "axis": { "title": "Nombre de cas positifs" }
            // },
            "tooltip": [{ "field": "covid_people", "type": "quantitative", "title": "Nombre de cas" }]
        },
        "config": {
            "axis": { "grid": true, "tickBand": "extent" }
        }
    }

    // see options at https://github.com/vega/vega-embed/blob/master/README.md
    var vlOpts = { width: 400, height: 400, actions: false };
    vegaEmbed("#heatmap", vlSpec, vlOpts);
};