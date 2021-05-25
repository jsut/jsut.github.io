var __ia = function intersectionAds() {
  const PREBID_TIMEOUT = 500;
  const DEBUG = true;
  const IAB_VIEWABLE_TIME = 1000;
  const IAB_VIEWABLE_THRESHOLD = 0.5

  // hook our internal pbjs up to the global pbjs, which may not be defined yet but will be eventually.
  window.pbjs = window.pbjs || {};
  window.pbjs.que = window.pbjs.que || [];
  let pbjs = window.pbjs;

  // control debug logging
  let setDebug = function setDebug(state) {
    DEBUG = state;
  }

  // return the prebid adUnits for the list of elements passed in
  // creates sizes from the attibutes on the element
  // uses the appnexus test configuration from prebid docs. This won't ever get filled running on github pages
  // unless you cname to a real domain. Maybe an ads.txt problem, I have no idea.
  let getAdUnits = function getAdUnits(list) {
    let adUnits = [];

    list.forEach(element => {
      adUnits.push({
        code: element.getAttribute('id'),
        mediaTypes: {
          banner: {
            sizes: [
              Number(element.getAttribute('width')),
              Number(element.getAttribute('height'))
            ]
          }
        },
        bids: [{
          bidder: 'appnexus',
          params: {
            placementId: 13144370
          }
        }]
      });
    })
    return adUnits;
  }

  // creates a safe frame with an id based on the placement you pass in with a
  // starting width and height that you pass in. does not add it to the DOM
  let makeSafeFrame = function(placement, width, height) {
    var frame = document.createElement("iframe");
    frame.setAttribute("id", placement + "-frame");
    frame.setAttribute("FRAMEBORDER", 0);
    frame.setAttribute("SCROLLING", "no");
    frame.setAttribute("MARGINHEIGHT", 0);
    frame.setAttribute("MARGINWIDTH", 0);
    frame.setAttribute("TOPMARGIN", 0);
    frame.setAttribute("LEFTMARGIN", 0);
    frame.setAttribute("ALLOWTRANSPARENCY", "true");
    frame.setAttribute("width", width);
    frame.setAttribute("height", height);
    return frame;
  };

  // this starts an auction, possibly for multiple placements, and sets up a bidsBackHandler that 
  // will render the winning bids for the placement(s) without using an ad server.
  let startAuction = function startAuction(list) {
    pbjs.que.push(function() {
      DEBUG && console.log('auction starting: ' + list.map(el => el.getAttribute('id')).join(' '));
      pbjs.removeAdUnit(); // remove any adunits we previously ran auctions for.
      pbjs.addAdUnits(getAdUnits(list));
      pbjs.requestBids({
        timeout: PREBID_TIMEOUT,
        bidsBackHandler: function(bids) {
          list.forEach(element => {
            let width = element.getAttribute('width');
            let height = element.getAttribute('height');
            let id = element.getAttribute('id');

            var iframe = makeSafeFrame(id, width, height);
            element.appendChild(iframe); // have to inject into dom for the contentWindow to get defined
            var iframeDoc = iframe.contentWindow.document;
            var adServerTargeting = pbjs.getAdserverTargetingForAdUnitCode(id);

            // If any bidders return any creatives
            if (adServerTargeting && adServerTargeting['hb_adid']) {
              pbjs.renderAd(iframeDoc, adServerTargeting['hb_adid']);
              DEBUG && console.log('ad rendered');
            } else {
              // if we didn't get any bids, do something?
              iframeDoc.write('<head></head><body>i only work on the real tubes</body>');
              iframeDoc.close();
            }
            console.log('ad-rs:' + iframeDoc.readyState);
            // once something is rendered, add the viewability observer
            viewable.observe(element);
            element.style.outline = 'red solid 5px';
            // this injects a click handler into the iframe, and lets us detect when an ad has been clicked on, if we
            // wanted to track that sort of thing.
            iframeDoc.addEventListener('click', (event) => {
              DEBUG && console.log(element.id + ' got clicked');
            });
          })
        }
      });
    });
  }

  // options for the iO that starts auctions. This one has a non zero root Margin, so that we will start the auction
  // before the ad is actually in view. The threshold is set to zero, because we want this to fire as soon as you get
  // within the rootMargin of seeing the ad.
  let adLoaderOptions = {
    root: null,
    rootMargin: '100px 0px',
    threshold: 0
  };

  // options for the iO that fires when the ad is viewed.  This one has no root margin, and a threshold of 1, 
  // because we only want it to fire when the entire ad placement has come into view.  This might actually be too
  // aggressive, because ads that are obscured, possibly by the edge of a browser if you're too narrow or something
  // will never have this fire.
  let viewableOptions = {
    root: null,
    rootMargin: '0px',
    threshold: IAB_VIEWABLE_THRESHOLD
  }

  // the iO callback, which is shared between the two iO's, but maybe shouldn't be.
  let auctionCallback = (entries, observer) => {
    let toStart = [];
    entries.forEach(entry => {
      if (entry.isIntersecting) {
        if (!entry.target.auctionStarted) {
          // if we're intersecting, and an auction hasn't started, start an auction.
          entry.target.auctionStarted = true;
          toStart.push(entry.target);
          // once the auction has started, stop observing this entry
          observer.unobserve(entry.target);
        }
      }
    });
    if (toStart.length) {
      startAuction(toStart);
    }
  };

  // markViewed returns a function what will be executed when a display ad has met the 
  // IAB definition of viewable
  let markViewed = (entry, observer) => {
    return () => {
      observer.unobserve(entry.target);
      entry.target.style.outline = 'green solid 5px';
      DEBUG && console.log(entry.target.getAttribute('id') + ' was viewed');
    }
  }

  // viewCallback is the callback used by the viewable IntersectionObserver.
  // when an ad comes into view, it sets a timeout for a function to be executed
  // when that ad would be considered viewed per the IAB specs
  let viewCallback = (entries, observer) => {
    entries.forEach(entry => {
      if (entry.isIntersecting) {
        DEBUG && console.log('start watching view time');
        entry.target.style.outline = 'yellow solid 5px';
        entry.target.view_tracker = setTimeout(markViewed(entry, observer), IAB_VIEWABLE_TIME);
      }
      else {
        DEBUG && console.log(entry.target.getAttribute('id') + ' is not viewable');
        if (entry.target.view_tracker) {
          clearTimeout(entry.target.view_tracker);
        }
      }
    });
  };

  // adLoader is the iO that will lazy load ads when they are close to view, or already in view (on page load)
  var adLoader = new IntersectionObserver(auctionCallback, adLoaderOptions);

  // viewable is the iO that will observe an ad to track if it actually becomes viweable or not.
  var viewable = new IntersectionObserver(viewCallback, viewableOptions);

  var domLoaded = function domLoaded(e) {
    // when the dom loads, we go look for ad divs, and set the adLoader up to observe them, which will start auctions if they are in or near view
    DEBUG && console.log('running domloaded, looking for ads in the DOM to obvserve');
    var elements = [...document.getElementsByClassName('ad')];
    elements.forEach(el => {
      adLoader.observe(el);
    });
  }

  // if the page is still loading, add a listener for DOMContentLoaded, otherwise, run the 
  // function directly and get going
  if (window.document.readyState === 'loading') {
    window.addEventListener('DOMContentLoaded', (event) => {
      domLoaded(event);
    });
  }
  else {
    domLoaded();
  }

  return {
    setDebug: setDebug
  }
}();