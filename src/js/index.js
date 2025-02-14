
import jQuery from "jquery";
window.$ = jQuery; // workaround for https://github.com/parcel-bundler/parcel/issues/333
import "bootstrap";
import instantsearch from "instantsearch.js/es";
import {
  searchBox,
  infiniteHits,
  refinementList,
  stats,
  configure,
  analytics,
  sortBy,
} from "instantsearch.js/es/widgets";
import TypesenseInstantSearchAdapter from "typesense-instantsearch-adapter";
import { SearchClient as TypesenseSearchClient } from "typesense"; // To get the total number of docs

let TYPESENSE_SERVER_CONFIG = {
  apiKey: process.env.TYPESENSE_SEARCH_ONLY_API_KEY ?? 'w9OqErTqRu8VtTgSAgMi3zEZWC1vtwMt1UNehMplNm6LYVN6',
  nodes: [
    {
      host: process.env.TYPESENSE_HOST ?? '35.154.85.33',
      port: process.env.TYPESENSE_PORT,
      protocol: process.env.TYPESENSE_PROTOCOL,
    },
  ],
  numRetries: 8,
  connectionTimeoutSeconds: 30000
};

console.log("Configs::::"+TYPESENSE_SERVER_CONFIG.apiKey);
console.log("Host::"+TYPESENSE_SERVER_CONFIG.host);

if (process.env[`TYPESENSE_HOST_2`]) {
  TYPESENSE_SERVER_CONFIG.nodes.push({
    host: process.env[`TYPESENSE_HOST_2`],
    port: process.env.TYPESENSE_PORT,
    protocol: process.env.TYPESENSE_PROTOCOL,
  });
}

if (process.env[`TYPESENSE_HOST_3`]) {
  TYPESENSE_SERVER_CONFIG.nodes.push({
    host: process.env[`TYPESENSE_HOST_3`],
    port: process.env.TYPESENSE_PORT,
    protocol: process.env.TYPESENSE_PROTOCOL,
  });
}

if (process.env[`TYPESENSE_HOST_NEAREST`]) {
  TYPESENSE_SERVER_CONFIG["nearestNode"] = {
    host: process.env[`TYPESENSE_HOST_NEAREST`],
    port: process.env.TYPESENSE_PORT,
    protocol: process.env.TYPESENSE_PROTOCOL,
  };
}

const INDEX_NAME = process.env.TYPESENSE_COLLECTION_NAME;

async function searchWithRetry(query, retries = 0, delay = 500) {
  try {
    const typesenseSearchClient = new TypesenseSearchClient(TYPESENSE_SERVER_CONFIG);
    const results = await typesenseSearchClient.collections(INDEX_NAME).documents().search(query);
    return results;
  } catch (error) {
    if (retries < 3) { // Retry up to 3 times
      console.log(`Retry ${retries + 1} in ${delay}ms`);
      await new Promise(resolve => setTimeout(resolve, delay));
      return searchWithRetry(query, retries + 1, delay * 2); // Exponential backoff
    } else {
      throw error;
    }
  }
}

async function getIndexSize() {
  let size = await searchWithRetry({ q: "*" });
  console.log("Size of collection::" + size.found);
  return size.found;
}



let indexSize;

(async () => {
  indexSize = await getIndexSize();
})();

let search;

function renderSearch(searchType) {
  if (search) {
    search.dispose();
  }

  let queryBy;

  if (searchType === "semantic") {
    queryBy = "embedding";
    sortBy= "releaseDate:desc";
  } else if (searchType === "keyword") {
    queryBy = "name,casting,genre,languages";
    sortBy = "releaseDate:desc";
  } else {
    queryBy = "embedding,name,casting,genre,languages";
    sortBy = "releaseDate:desc";
  }

  const typesenseInstantsearchAdapter = new TypesenseInstantSearchAdapter({
    server: TYPESENSE_SERVER_CONFIG,
    // The following parameters are directly passed to Typesense's search API endpoint.
    //  So you can pass any parameters supported by the search endpoint below.
    //  queryBy is required.
    additionalSearchParameters: {
      query_by: queryBy,
      sort_by:sortBy,

      exclude_fields: "embedding",
    },
  });
  const searchClient = typesenseInstantsearchAdapter.searchClient;

  search = instantsearch({
    searchClient,
    indexName: INDEX_NAME,
    routing: true,
    async searchFunction(helper) {
      // This fetches 200 (nearest neighbor) results for semantic / hybrid search

      let query = helper.getQuery().query;
      const page = helper.getPage(); // Retrieve the current page

      if (
        query !== "" &&
        ["semantic", "hybrid"].includes($("#search-type-select").val())
      ) {
        console.log(helper.getQuery().query);
        helper
          .setQueryParameter(
            "typesenseVectorQuery", // <=== Special parameter that only works in typesense-instantsearch-adapter@2.7.0-3 and above
            `embedding:([], k:500)`,
          )
          .setPage(page)
          .search();
        console.log(helper.getQuery().query);
      } else {
        helper
          .setQueryParameter("typesenseVectorQuery", null)
          .setPage(page)
          .search();
      }
    },
  });

  search.addWidgets([
    searchBox({
      container: "#searchbox",
      showSubmit: false,
      showReset: false,
      placeholder:
        "Type in a search term, or click on one of the examples below",

      autofocus: true,
      cssClasses: {
        input: "form-control",
      },

    }),

    analytics({
      pushFunction(formattedParameters, state, results) {
        window.ga(
          "set",
          "page",
          (window.location.pathname + window.location.search).toLowerCase(),
        );
        window.ga("send", "pageView");
      },
    }),

    stats({
      container: "#stats",
      cssClasses: {
        text: "text-muted small",
        root: "text-end",
      },
      templates: {
        text: ({ nbHits, hasNoResults, hasOneResult, processingTimeMS }) => {
          let statsText = "";
          if (hasNoResults) {
            statsText = "No results";
          } else if (hasOneResult) {
            statsText = "1 result";
          } else {
            statsText = `${nbHits.toLocaleString()} results`;
          }
          return `${statsText} found ${indexSize
            ? ` - Searched ${indexSize.toLocaleString()} comments`
            : ""
            } in ${processingTimeMS}ms.`;
        },
      },
    }),
    
    infiniteHits({
      container: "#hits",
      cssClasses: {
        list: "list-unstyled grid-container",
        item: "d-flex flex-column search-result-card bg-light-2",
        loadMore: "btn btn-primary mx-auto d-block mt-4",
      },
      templates: {
        item(hit) {
          const epochTime = hit._highlightResult.releaseDate.value || hit.value;
          const timestamp = parseInt(epochTime, 10); // Parse to integer
          const ISTTime = new Date(timestamp).toLocaleString('en-IN', {
            timeZone: 'Asia/Kolkata'
          });
          return `
            <div class="result-container mb-4">
              <div class="text-muted small">
                <span class="text-primary">${decodeHtml(hit._highlightResult.name.value || '')}</span> |
                ${decodeHtml(hit._highlightResult.dataType.value || '')} | 
                ${ISTTime} | 
                ${decodeHtml(hit._highlightResult.genre.map(genre => genre.value).join(', ') || '')} |
                ${decodeHtml(hit._highlightResult.languages.map(languages=>languages.value).join(',') || '')} |
                ${decodeHtml(hit._highlightResult.casting.map(casting => casting.value).join(',') || '')} |
                ${decodeHtml(hit._highlightResult.networkName.value || '')}
              </div>
              <div class="mt-1">
              ${decodeHtml(hit._highlightResult.description && hit._highlightResult.description.value || '')}
            </div>
            </div>
          `;
        },
        empty: "No comments found for <q>{{ query }}</q>. Try another search term.",
      },
      transformItems: (items) => {
        return items.map((item) => {
          return {
            ...item,
            display_timestamp: (() => {
              const parsedDate = new Date(item.releaseDate);
              return `${parsedDate.toLocaleString()}`;
            })(),
          };
        });
      },
    }),
    refinementList({
      container: "#users-refinement-list",
      attribute: "dataType",
      searchable: true,
      searchablePlaceholder: "Search Content Type",
      showMore: true,
      cssClasses: {
        searchableInput: "form-control form-control-sm mb-2 border-light-2",
        searchableSubmit: "d-none",
        searchableReset: "d-none",
        list: "list-unstyled",
        count: "badge rounded-pill text-bg-light fw-normal text-muted ms-2",
        label: "d-flex align-items-center",
        checkbox: "me-2",
      },
    }),
     refinementList({
        container: "#language-refinement-list",
        attribute: "languages",
        searchable: true,
        searchablePlaceholder: "Search Language",
        showMore: true,
        cssClasses: {
          searchableInput: "form-control form-control-sm mb-2 border-light-2",
          searchableSubmit: "d-none",
          searchableReset: "d-none",
          showMore: "btn btn-primary btn-sm",
         list: "list-unstyled",
          count: "badge rounded-pill text-bg-light fw-normal text-muted ms-2",
          label: "d-flex align-items-center",
          checkbox: "me-2",
        },
      }),
    refinementList({
      container: "#gernes-refinement-list",
      attribute: "genre",
      searchable: true,
      searchablePlaceholder: "Search Genre",
      showMore: true,
      cssClasses: {
        searchableInput: "form-control form-control-sm mb-2 border-light-2",
        searchableSubmit: "d-none",
        searchableReset: "d-none",
        showMore: "btn btn-primary btn-sm",
        list: "list-unstyled",
        count: "badge rounded-pill text-bg-light fw-normal text-muted ms-2",
        label: "d-flex align-items-center",
        checkbox: "me-2",
      },
    }),
    refinementList({
      container: "#networks-refinement-list",
      attribute: "networkName",
      searchable: true,
      searchablePlaceholder: "Search Partner",
      showMore: true,
      cssClasses: {
        searchableInput: "form-control form-control-sm mb-2 border-light-2",
        searchableSubmit: "d-none",
        searchableReset: "d-none",
        showMore: "btn btn-primary btn-sm",
        list: "list-unstyled",
        count: "badge rounded-pill text-bg-light fw-normal text-muted ms-2",
        label: "d-flex align-items-center",
        checkbox: "me-2",
      },
    }),
    configure({
      hitsPerPage: 15,
      q: "New",
      queryBy: "name",
    }),
  ]);
  search.on("render", function () {
    // Make artist names clickable
    $("#hits .clickable-search-term").on("click", handleSearchTermClick);
  });

  search.start();
}

function handleSearchTermClick(event) {
  const $searchBox = $("#searchbox input[type=search]");
  search.helper.clearRefinements();
  $searchBox.val(event.currentTarget.textContent);
  search.helper.setQuery($searchBox.val()).search();
  console.log("$searchBox.val() ", $searchBox.val());
}

// Source: https://stackoverflow.com/a/42182294/123545
function decodeHtml(html) {
  var txt = document.createElement("textarea");
  txt.innerHTML = html;
  return txt.value;
}

//function documentList(values){
//values.array.forEach(v => {
//return v;
//});
//}

$(function () {
  const $searchBox = $("#searchbox input[type=search]");

  renderSearch($("#search-type-select").val());

  // Handle example search terms
  $(".clickable-search-term").on("click", handleSearchTermClick);
  $("#search-type-select").on("change", function () {
    const searchType = this.value;
    renderSearch(searchType);
  });

  // Clear refinements, when searching
  $searchBox.on("keydown", (event) => {
    search.helper.clearRefinements();
  });

  if (!matchMedia("(min-width: 768px)").matches) {
    $searchBox.on("focus, keydown", () => {
      $("html, body").animate(
        {
          scrollTop: $("#searchbox-container").offset().top,
        },
        500,
      );
    });
  }
});

// $(document).ready(function () {
//   frndlyData();
// });

// window.onload = function () {
//   frndlyData();
// }

//frndly tv search api 
async function frndlyData() {
  fetch("https://frndlytv-preprodapi.revlet.net/search/api/tivo/v1/get/search/query?query=friends&limit=16&offset=0&bucket=All", {
    "headers": {
      "accept": "application/json, text/plain, */*",
      "accept-language": "en-GB,en;q=0.9",
      "box-id": "1a758756-5bab-125c-0712-1b07982a154f",
      "sec-ch-ua": "\"Chromium\";v=\"122\", \"Not(A:Brand\";v=\"24\", \"Google Chrome\";v=\"122\"",
      "sec-ch-ua-mobile": "?0",
      "sec-ch-ua-platform": "\"Windows\"",
      "sec-fetch-dest": "empty",
      "sec-fetch-mode": "cors",
      "sec-fetch-site": "same-site",
      "session-id": "ca417d51-fffe-4b32-8c80-dada1f0fe658",
      "tenant-code": "frndlytv",
      "Referer": "https://frndlytv-prod-copyweb.revlet.net/"
    },
    "body": null,
    "method": "GET"
  }).then(response => {
    console.log("response ", response);
    return response.json();
  }).then(data => {
    data
    console.log(data);
    let properties = Object.values(data.response);
    properties.forEach(prop => {
      prop.data.map(p => {
        p.hover.elements.forEach(pp => {
          const markup = `<li class="no"><h5>Name</h5>${decodeHtml(pp.value)}</li>`;
          console.log("ppvalue - ", pp.value);
          $('#frndly').append(markup);
        })
      })
    })
  }).catch(error => console.log(error));
}



/**async function frndlyData() {
  let response = await fetch("https://frndlytv-preprodapi.revlet.net/search/api/tivo/v1/get/search/query?query=love&limit=16&offset=0&bucket=All", {
    "headers": {
      "accept": "application/json, text/plain, ",
      "accept-language": "en-GB,en;q=0.9",
      "box-id": "49dfb0f3-656c-9ec7-1041-fc3645e086f8",
      "sec-ch-ua": "\"Not A(Brand\";v=\"99\", \"Google Chrome\";v=\"121\", \"Chromium\";v=\"121\"",
      "sec-ch-ua-mobile": "?0",
      "sec-ch-ua-platform": "\"Windows\"",
      "sec-fetch-dest": "empty",
      "sec-fetch-mode": "cors",
      "sec-fetch-site": "same-site",
      "session-id": "3c0e588e-0ec1-4454-b992-a58a34158731",
      "tenant-code": "frndlytv",
      "Referer": "https://frndlytv-prod-copyweb.revlet.net/",
      "Access-Control-Allow-Origin":"*",
      "Access-Control-Allow-Methods":"GET, POST, PUT, DELETE, OPTIONS",
      "Access-Control-Allow-Headers":"origin, content-type, accept, x-requested-with",
      "Access-Control-Max-Age":"3600"
    },
    "body": null,
    "method": "GET"
  });
  let data= await response.json();
}

frndlyData().then(response=>{
  console.log(response)
})*/

